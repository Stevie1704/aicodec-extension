import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// WSL UNC path matching patterns
const WSL_DOLLAR_PATTERN = /^\\\\wsl\$\\([^\\]+)\\?(.*)?$/i;
const WSL_LOCALHOST_PATTERN = /^\\\\wsl\.localhost\\([^\\]+)\\?(.*)?$/i;

/**
 * Checks if a path is a WSL UNC path (Windows accessing WSL filesystem).
 * WSL UNC paths look like: \\wsl$\Ubuntu\home\user or \\wsl.localhost\Ubuntu\home\user
 */
function isWslUncPath(inputPath: string): boolean {
    if (!inputPath) return false;
    const normalized = inputPath.replace(/\//g, '\\');
    return normalized.startsWith('\\\\wsl$\\') || normalized.startsWith('\\\\wsl.localhost\\');
}

/**
 * Converts a WSL UNC path to a proper WSL Unix path.
 * Example: \\wsl$\Ubuntu\home\user\project -> /home/user/project
 * Example: \\wsl.localhost\Ubuntu\home\user\project -> /home/user/project
 */
function convertWslUncToUnixPath(uncPath: string): string {
    if (!isWslUncPath(uncPath)) {
        return uncPath;
    }

    // Normalize to use backslashes for consistent parsing
    const normalized = uncPath.replace(/\//g, '\\');

    const match = normalized.match(WSL_DOLLAR_PATTERN) || normalized.match(WSL_LOCALHOST_PATTERN);

    if (match) {
        // match[1] = distro name (e.g., "Ubuntu")
        // match[2] = rest of the path (e.g., "home\user\project")
        const restOfPath = match[2] || '';
        // Convert backslashes to forward slashes and ensure leading slash
        const unixPath = '/' + restOfPath.replace(/\\/g, '/');
        return unixPath;
    }

    return uncPath;
}

/**
 * Gets the WSL distribution name from a UNC path.
 * Returns null if not a WSL UNC path or if the distro name is invalid.
 */
function getWslDistroFromUncPath(uncPath: string): string | null {
    if (!isWslUncPath(uncPath)) {
        return null;
    }

    const normalized = uncPath.replace(/\//g, '\\');
    const match = normalized.match(WSL_DOLLAR_PATTERN) || normalized.match(WSL_LOCALHOST_PATTERN);

    if (!match) {
        return null;
    }

    // Sanitize distro name to prevent command injection
    // Only allow alphanumeric characters, hyphens, underscores, and dots
    // (valid WSL distro names follow these patterns)
    const distro = match[1];
    if (!/^[a-zA-Z0-9_.-]+$/.test(distro)) {
        console.warn(`Invalid WSL distro name detected: ${distro}`);
        return null;
    }

    return distro;
}

/**
 * Escapes a string for safe use in bash shell commands.
 * Uses single quotes which preserve all characters literally,
 * except for single quotes themselves which require special handling.
 */
function escapeForBash(arg: string): string {
    // Single quotes preserve everything literally except single quotes
    // To include a single quote: end string, add escaped quote, restart string
    // Example: "it's" becomes 'it'\''s'
    return "'" + arg.replace(/'/g, "'\\''") + "'";
}

export interface CliResult {
    success: boolean;
    stdout: string;
    stderr: string;
}

/**
 * Finds the aicodec CLI executable.
 * Checks in order:
 * 1. User-configured path from settings
 * 2. WSL PATH (if workspace is in WSL)
 * 3. System PATH environment variable
 */
export async function findAicodecCli(): Promise<string | null> {
    // Check user configuration first
    const config = vscode.workspace.getConfiguration('aicodec');
    const configuredPath = config.get<string>('cliPath');

    if (configuredPath && configuredPath !== 'aicodec') {
        // User specified a custom path
        if (await isCliValid(configuredPath)) {
            return configuredPath;
        }
    }

    // Check if workspace is in WSL
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const workspacePath = workspaceFolders?.[0]?.uri.fsPath;

    if (workspacePath && isWslUncPath(workspacePath)) {
        // Try to find CLI in WSL
        const distro = getWslDistroFromUncPath(workspacePath);
        const wslCliPath = await findInWslPath('aicodec', distro);
        if (wslCliPath) {
            // Return a marker that indicates this is a WSL CLI
            // The executeCliCommand function will handle this
            return wslCliPath;
        }
    }

    // Try to find in Windows/native PATH
    const cliPath = await findInPath('aicodec');
    if (cliPath) {
        return cliPath;
    }

    return null;
}

/**
 * Checks if the CLI at the given path is valid and executable.
 */
async function isCliValid(cliPath: string): Promise<boolean> {
    try {
        const { stdout } = await execAsync(`"${cliPath}" --version`, { timeout: 5000 });
        return stdout.includes('aicodec') || stdout.length > 0;
    } catch {
        return false;
    }
}

/**
 * Finds an executable in the system PATH.
 */
async function findInPath(executable: string): Promise<string | null> {
    const isWindows = process.platform === 'win32';
    const command = isWindows ? `where ${executable}` : `which ${executable}`;

    try {
        const { stdout } = await execAsync(command, { timeout: 5000 });
        const paths = stdout.trim().split('\n');
        return paths[0] || null;
    } catch {
        return null;
    }
}

/**
 * Finds an executable in WSL's PATH.
 * @param executable The name of the executable to find
 * @param distro Optional WSL distribution name
 * @returns The path to the executable in WSL, or null if not found
 */
async function findInWslPath(executable: string, distro: string | null): Promise<string | null> {
    try {
        const distroArg = distro ? `-d ${distro}` : '';
        const command = `wsl ${distroArg} which ${executable}`.trim();
        const { stdout } = await execAsync(command, { timeout: 10000 });
        const wslPath = stdout.trim();
        if (wslPath) {
            // Return the WSL path as-is - the execute function will handle it
            return wslPath;
        }
        return null;
    } catch (error) {
        console.error('Error finding executable in WSL PATH:', error);
        return null;
    }
}

/**
 * Executes an aicodec CLI command.
 * Handles WSL UNC paths by executing the command inside WSL when necessary.
 */
export async function executeCliCommand(
    cliPath: string,
    args: string[],
    cwd?: string
): Promise<CliResult> {
    try {
        let command: string;
        let execOptions: { cwd?: string; timeout: number; maxBuffer: number };

        // Check if we need to execute inside WSL (Windows host with WSL workspace)
        if (cwd && isWslUncPath(cwd)) {
            const distro = getWslDistroFromUncPath(cwd);
            const unixCwd = convertWslUncToUnixPath(cwd);

            // Determine the CLI path to use in WSL
            let wslCliPath: string;
            if (isWslUncPath(cliPath)) {
                // Convert WSL UNC path to Unix path
                wslCliPath = convertWslUncToUnixPath(cliPath);
            } else if (cliPath.startsWith('/')) {
                // Already a Unix path (e.g., from findInWslPath)
                wslCliPath = cliPath;
            } else {
                // Windows path or just 'aicodec' - fall back to PATH lookup in WSL
                wslCliPath = 'aicodec';
            }

            // Normalize paths in arguments (convert backslashes to forward slashes for WSL)
            // and properly escape for bash using single quotes
            const escapedArgs = args.map(arg => {
                // Convert backslashes to forward slashes in paths
                // This handles file paths like "src\file.ts" -> "src/file.ts"
                const normalized = arg.replace(/\\/g, '/');
                // Use proper shell escaping with single quotes
                return escapeForBash(normalized);
            }).join(' ');

            // Escape the cwd and cli path as well
            const escapedCwd = escapeForBash(unixCwd);
            const escapedCliPath = escapeForBash(wslCliPath);

            // Build the WSL command
            // Note: escapedCwd and escapedCliPath are already single-quoted by escapeForBash
            if (distro) {
                command = `wsl -d ${distro} bash -c "cd ${escapedCwd} && ${escapedCliPath} ${escapedArgs}"`;
            } else {
                // Fallback without distro specification
                command = `wsl bash -c "cd ${escapedCwd} && ${escapedCliPath} ${escapedArgs}"`;
            }

            console.log(`Executing via WSL: ${command}`);

            // Don't pass cwd to execAsync since we're handling it in the WSL command
            execOptions = {
                timeout: 60000,
                maxBuffer: 10 * 1024 * 1024
            };
        } else {
            // Standard execution (non-WSL)
            command = `"${cliPath}" ${args.join(' ')}`;
            console.log(`Executing: ${command}`);

            execOptions = {
                cwd: cwd,
                timeout: 60000,
                maxBuffer: 10 * 1024 * 1024
            };
        }

        const { stdout, stderr } = await execAsync(command, execOptions);

        return {
            success: true,
            stdout: stdout,
            stderr: stderr
        };
    } catch (error: any) {
        return {
            success: false,
            stdout: error.stdout || '',
            stderr: error.stderr || error.message
        };
    }
}

/**
 * Shows the CLI not found prompt and handles user response.
 */
export async function showCliNotFoundPrompt(): Promise<'install' | 'manual' | 'fallback' | 'cancel'> {
    const install = 'Install aicodec CLI';
    const manual = 'Set Path Manually';
    const fallback = 'Use Built-in (Limited)';
    const cancel = 'Cancel';

    const selection = await vscode.window.showWarningMessage(
        'aicodec CLI not found. The CLI is required for full functionality (apply/revert with session management).',
        install,
        manual,
        fallback,
        cancel
    );

    switch (selection) {
        case install:
            return 'install';
        case manual:
            return 'manual';
        case fallback:
            return 'fallback';
        default:
            return 'cancel';
    }
}

/**
 * Opens a terminal and runs the installation script.
 */
export async function installCliViaScript(): Promise<void> {
    const terminal = vscode.window.createTerminal('Install aicodec');
    terminal.show();

    const isWindows = process.platform === 'win32';

    if (isWindows) {
        // Windows PowerShell installation
        terminal.sendText('powershell -Command "irm https://raw.githubusercontent.com/Stevie1704/aicodec/main/scripts/install.ps1 | iex"');
    } else {
        // Linux/macOS bash installation
        terminal.sendText('curl -sSL https://raw.githubusercontent.com/Stevie1704/aicodec/main/scripts/install.sh | bash');
    }

    vscode.window.showInformationMessage(
        'Installing aicodec CLI... Please wait for the installation to complete in the terminal.',
        'OK'
    );
}

/**
 * Prompts the user to manually set the CLI path.
 */
export async function promptForCliPath(): Promise<void> {
    const fileUri = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        openLabel: 'Select aicodec Executable',
        title: 'Select the aicodec CLI executable',
        filters: process.platform === 'win32' ? {
            'Executable': ['exe']
        } : undefined
    });

    if (fileUri && fileUri[0]) {
        const selectedPath = fileUri[0].fsPath;

        // Validate the selected file
        if (await isCliValid(selectedPath)) {
            const config = vscode.workspace.getConfiguration('aicodec');
            await config.update('cliPath', selectedPath, vscode.ConfigurationTarget.Global);

            vscode.window.showInformationMessage(`aicodec CLI path set to: ${selectedPath}`);
        } else {
            vscode.window.showErrorMessage(
                'The selected file does not appear to be a valid aicodec CLI executable. Please try again.'
            );
        }
    }
}

/**
 * Main function to ensure CLI is available.
 * Returns the CLI path if available, or handles the user's choice.
 */
export async function ensureCliAvailable(): Promise<{
    available: boolean;
    cliPath: string | null;
    useFallback: boolean;
}> {
    let cliPath = await findAicodecCli();

    if (cliPath) {
        return { available: true, cliPath, useFallback: false };
    }

    // CLI not found, prompt user
    const choice = await showCliNotFoundPrompt();

    switch (choice) {
        case 'install':
            await installCliViaScript();
            vscode.window.showInformationMessage(
                'After installation completes, please reload the window.',
                'Reload Window'
            ).then(selection => {
                if (selection === 'Reload Window') {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            });
            return { available: false, cliPath: null, useFallback: false };

        case 'manual':
            await promptForCliPath();
            cliPath = await findAicodecCli();
            return {
                available: cliPath !== null,
                cliPath,
                useFallback: false
            };

        case 'fallback':
            vscode.window.showInformationMessage(
                'Using built-in functionality. Note: This does not include session management or revert.json creation.'
            );
            return { available: false, cliPath: null, useFallback: true };

        default:
            return { available: false, cliPath: null, useFallback: false };
    }
}

/**
 * Applies changes using the CLI.
 */
export async function applyChangesViaCli(
    cliPath: string,
    projectRoot: string,
    filePaths?: string[]
): Promise<CliResult> {
    const args = ['apply'];

    if (filePaths && filePaths.length > 0) {
        args.push('--files', ...filePaths.map(path => `"${path}"`));
    } else {
        args.push('--all');
    }

    return executeCliCommand(cliPath, args, projectRoot);
}

/**
 * Reverts changes using the CLI.
 */
export async function revertChangesViaCli(
    cliPath: string,
    projectRoot: string,
    filePaths?: string[]
): Promise<CliResult> {
    const args = ['revert'];

    if (filePaths && filePaths.length > 0) {
        args.push('--files', ...filePaths.map(path => `"${path}"`));
    } else {
        args.push('--all');
    }

    return executeCliCommand(cliPath, args, projectRoot);
}

/**
 * Runs aggregate command using the CLI.
 */
export async function aggregateViaCli(
    cliPath: string,
    projectRoot: string,
    forceRehash: boolean = false
): Promise<CliResult> {
    const args = ['aggregate'];

    if (forceRehash) {
        args.push('-f');
    }

    return executeCliCommand(cliPath, args, projectRoot);
}

/**
 * Initializes a new aicodec project using the CLI.
 */
export async function initViaCli(
    cliPath: string,
    projectRoot: string
): Promise<CliResult> {
    const args = ['init'];
    return executeCliCommand(cliPath, args, projectRoot);
}

/**
 * Prints the JSON schema for LLM change proposals using the CLI.
 */
export async function schemaViaCli(
    cliPath: string,
    projectRoot: string
): Promise<CliResult> {
    const args = ['schema'];
    return executeCliCommand(cliPath, args, projectRoot);
}

/**
 * Builds a map of the repository structure using the CLI.
 */
export async function buildmapViaCli(
    cliPath: string,
    projectRoot: string,
    useGitignore: boolean = true
): Promise<CliResult> {
    const args = ['buildmap'];

    if (useGitignore) {
        args.push('--use-gitignore');
    } else {
        args.push('--no-gitignore');
    }

    return executeCliCommand(cliPath, args, projectRoot);
}

/**
 * Gets the version of the aicodec CLI.
 */
export async function getCliVersion(
    cliPath: string,
    projectRoot: string
): Promise<string | null> {
    try {
        const result = await executeCliCommand(cliPath, ['-v'], projectRoot);
        if (result.success && result.stdout) {
            // Parse version from output (e.g., "aicodec version 2.11.3")
            const match = result.stdout.match(/(\d+\.\d+\.\d+)/);
            return match ? match[1] : null;
        }
        return null;
    } catch (error) {
        console.error('Failed to get CLI version:', error);
        return null;
    }
}

/**
 * Compares two semantic version strings.
 * Returns: -1 if v1 < v2, 0 if v1 == v2, 1 if v1 > v2
 */
export function compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const part1 = parts1[i] || 0;
        const part2 = parts2[i] || 0;

        if (part1 < part2) return -1;
        if (part1 > part2) return 1;
    }

    return 0;
}

/**
 * Checks for aicodec CLI updates (non-intrusive check only).
 * Requires aicodec >= 2.11.0
 */
export async function checkForUpdatesViaCli(
    cliPath: string,
    projectRoot: string
): Promise<CliResult> {
    const args = ['update', '--check'];
    return executeCliCommand(cliPath, args, projectRoot);
}

/**
 * Updates aicodec CLI to the latest version.
 */
export async function updateViaCli(
    cliPath: string,
    projectRoot: string
): Promise<CliResult> {
    const args = ['update'];
    return executeCliCommand(cliPath, args, projectRoot);
}

/**
 * Checks if aicodec CLI was installed via pip.
 */
export async function isInstalledViaPip(): Promise<boolean> {
    try {
        const { stdout } = await execAsync('pip show aicodec', { timeout: 5000 });
        return stdout.includes('Name: aicodec');
    } catch {
        return false;
    }
}

/**
 * Generates a prompt file with aggregated context using the CLI.
 */
export async function promptViaCli(
    cliPath: string,
    projectRoot: string,
    options: {
        task?: string;
        minimal?: boolean;
        techStack?: string;
        outputFile?: string;
        clipboard?: boolean;
        noOutputInstruction?: boolean;
        newProject?: boolean;
        noCode?: boolean;
        includeMap?: boolean;
        excludeMap?: boolean;
        skipEditor?: boolean;
    } = {}
): Promise<CliResult> {
    const args = ['prompt'];

    // Always pass --task, even if empty string, to override CLI default placeholder
    if (options.task !== undefined) {
        args.push('--task', `"${options.task}"`);
    }
    if (options.minimal) {
        args.push('--minimal');
    }
    // Always pass --tech-stack if provided, even if empty string
    if (options.techStack !== undefined) {
        args.push('--tech-stack', `"${options.techStack}"`);
    }
    if (options.outputFile) {
        args.push('--output-file', `"${options.outputFile}"`);
    }
    if (options.clipboard) {
        args.push('--clipboard');
    }
    if (options.noOutputInstruction) {
        args.push('--no-output-instruction');
    }
    if (options.newProject) {
        args.push('--new-project');
    }
    if (options.noCode) {
        args.push('--no-code');
    }
    if (options.includeMap) {
        args.push('--include-map');
    }
    if (options.excludeMap) {
        args.push('--exclude-map');
    }
    if (options.skipEditor) {
        args.push('--skip-editor');
    }

    return executeCliCommand(cliPath, args, projectRoot);
}

/**
 * Prepares the changes file (from editor or clipboard) using the CLI.
 */
export async function prepareViaCli(
    cliPath: string,
    projectRoot: string,
    options: {
        changesFile?: string;
        fromClipboard?: boolean;
        skipEditor?: boolean;
    } = {}
): Promise<CliResult> {
    const args = ['prepare'];

    if (options.changesFile) {
        args.push('--changes', `"${options.changesFile}"`);
    }
    if (options.fromClipboard) {
        args.push('--from-clipboard');
    }
    if (options.skipEditor) {
        args.push('--skip-editor');
    }

    return executeCliCommand(cliPath, args, projectRoot);
}

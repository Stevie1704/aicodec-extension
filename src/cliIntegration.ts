import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface CliResult {
    success: boolean;
    stdout: string;
    stderr: string;
}

/**
 * Finds the aicodec CLI executable.
 * Checks in order:
 * 1. User-configured path from settings
 * 2. PATH environment variable
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

    // Try to find in PATH
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
 * Executes an aicodec CLI command.
 */
export async function executeCliCommand(
    cliPath: string,
    args: string[],
    cwd?: string
): Promise<CliResult> {
    try {
        const command = `"${cliPath}" ${args.join(' ')}`;
        console.log(`Executing: ${command}`);

        const { stdout, stderr } = await execAsync(command, {
            cwd: cwd,
            timeout: 60000, // 60 seconds timeout
            maxBuffer: 10 * 1024 * 1024 // 10MB buffer
        });

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

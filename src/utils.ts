import * as vscode from 'vscode';
import * as path from 'path';

export const AICODEC_PATH_KEY = 'aicodecPath';

export async function getAicodecPath(context: vscode.ExtensionContext): Promise<string | undefined> {
    let aicodecPath = context.workspaceState.get<string>(AICODEC_PATH_KEY);
    if (!aicodecPath) {
        const pathUri = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Select .aicodec Folder',
            title: 'Select .aicodec Folder Path'
        });

        if (pathUri && pathUri[0]) {
            aicodecPath = pathUri[0].fsPath;
            if (path.basename(aicodecPath) !== '.aicodec') {
                vscode.window.showErrorMessage('The selected folder must be named ".aicodec".');
                return undefined;
            }
            await context.workspaceState.update(AICODEC_PATH_KEY, aicodecPath);
        }
    }
    return aicodecPath;
}

export interface AicodecFile {
    filePath: string;
    content: string;
}

export async function readAicodecJson(aicodecPath: string, fileName: string): Promise<AicodecFile[]> {
    const filePath = path.join(aicodecPath, fileName);
    try {
        const fileUri = vscode.Uri.file(filePath);
        const fileContents = await vscode.workspace.fs.readFile(fileUri);
        const text = Buffer.from(fileContents).toString('utf8');
        const data = JSON.parse(text);
        if (Array.isArray(data)) {
            // Ensure items have the required properties
            return data.filter(item => item && typeof item.filePath === 'string');
        }
        return [];
    } catch (error) {
        if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
            // This is not an error, the file just might not exist yet.
            return [];
        }
        console.error(`Error reading or parsing ${fileName}:`, error);
        return [];
    }
}

import * as vscode from 'vscode';
import * as path from 'path';

export function getAicodecPath(): string | undefined {
    const config = vscode.workspace.getConfiguration('aicodec');
    const aicodecPath = config.get<string>('path');

    if (!aicodecPath || aicodecPath.trim() === '') {
        return undefined;
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

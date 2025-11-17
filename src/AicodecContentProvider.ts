import * as vscode from 'vscode';
import { readAicodecJson } from './utils';

export class AicodecContentProvider implements vscode.TextDocumentContentProvider {

    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        // Check if this is an empty file URI
        if (uri.scheme === 'aicodec-empty') {
            return ''; // Return empty content for non-existent files
        }

        const { aicodecPath, jsonFile, relativePath } = this.parseUri(uri);

        if (!aicodecPath || !jsonFile || !relativePath) {
            return `Error: Invalid URI format: ${uri.toString()}`;
        }

        try {
            const files = await readAicodecJson(aicodecPath, jsonFile);
            const targetFile = files.find(f => f.filePath === relativePath);
            return targetFile?.content || `// Content for ${relativePath} not found in ${jsonFile}`;
        } catch (e) {
            console.error(e);
            return `Error loading content for ${uri.toString()}. See console for details.`;
        }
    }
    
    // URI format: aicodec-readonly://aicodec-data/${encodedData}
    private parseUri(uri: vscode.Uri): { aicodecPath?: string, jsonFile?: string, relativePath?: string } {
        // Remove the '/aicodec-data/' prefix
        const encodedData = uri.path.replace(/^\/aicodec-data\//, '');
        const parts = encodedData.split(':');

        if (parts.length < 3) {
            return {};
        }

        const aicodecPath = decodeURIComponent(parts[0]);
        const jsonFile = decodeURIComponent(parts[1]);
        const relativePath = decodeURIComponent(parts.slice(2).join(':')); // Handle colons in file paths

        return { aicodecPath, jsonFile, relativePath };
    }

    static encodeUri(aicodecPath: string, jsonFile: string, relativePath: string): vscode.Uri {
        const encodedPath = encodeURIComponent(aicodecPath);
        const encodedJson = encodeURIComponent(jsonFile);
        const encodedRelative = encodeURIComponent(relativePath);

        // Use authority component to avoid double-slash issues
        return vscode.Uri.parse(`aicodec-readonly://aicodec-data/${encodedPath}:${encodedJson}:${encodedRelative}`);
    }

    static encodeEmptyUri(filePath: string): vscode.Uri {
        // Create a virtual URI for an empty file (non-existent file)
        // Use 'empty' as authority to avoid double slash issue
        return vscode.Uri.parse(`aicodec-empty://empty${filePath.startsWith('/') ? '' : '/'}${filePath}`);
    }
}

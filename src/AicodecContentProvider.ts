import * as vscode from 'vscode';
import { getAicodecPath, readAicodecJson } from './utils';

export class AicodecContentProvider implements vscode.TextDocumentContentProvider {
    constructor(private context: vscode.ExtensionContext) {}

    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
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
    
    // URI format: aicodec-readonly:/${aicodecPath}:${jsonFile}:${relativePath}
    private parseUri(uri: vscode.Uri): { aicodecPath?: string, jsonFile?: string, relativePath?: string } {
        const [aicodecPath, jsonFile, relativePath] = uri.path.substring(1).split(':').map(decodeURIComponent);
        return { aicodecPath, jsonFile, relativePath };
    }

    static encodeUri(aicodecPath: string, jsonFile: string, relativePath: string): vscode.Uri {
        const path = [aicodecPath, jsonFile, relativePath].map(encodeURIComponent).join(':');
        return vscode.Uri.parse(`aicodec-readonly:/${path}`);
    }
}

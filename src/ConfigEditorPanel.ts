import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getAicodecPath } from './utils';

interface AicodecConfig {
    aggregate: {
        directories: string[];
        exclude: string[];
        include: string[];
        plugins: Array<{ extension: string; command: string }>;
        use_gitignore: boolean;
    };
    prompt: {
        output_file: string;
        minimal: boolean;
        tech_stack?: string;
        include_map: boolean;
        include_code: boolean;
        clipboard: boolean;
    };
    prepare: {
        changes: string;
        from_clipboard: boolean;
    };
    apply: {
        output_dir: string;
    };
}

export class ConfigEditorPanel {
    public static currentPanel: ConfigEditorPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it
        if (ConfigEditorPanel.currentPanel) {
            ConfigEditorPanel.currentPanel._panel.reveal(column);
            return;
        }

        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            'aicodecConfigEditor',
            'AIcodec Configuration',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri]
            }
        );

        ConfigEditorPanel.currentPanel = new ConfigEditorPanel(panel, extensionUri);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        // Set the webview's initial html content
        this._update();

        // Listen for when the panel is disposed
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'load':
                        this._loadConfig();
                        return;
                    case 'save':
                        this._saveConfig(message.config);
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    private _loadConfig() {
        const aicodecPath = getAicodecPath();
        if (!aicodecPath) {
            vscode.window.showErrorMessage('AIcodec path is not set. Please configure it first.');
            return;
        }

        const configPath = path.join(aicodecPath, 'config.json');

        try {
            const configContent = fs.readFileSync(configPath, 'utf8');
            const loadedConfig = JSON.parse(configContent);

            // Merge loaded config with defaults to ensure all fields exist
            const config = this._mergeWithDefaults(loadedConfig);

            // Send config to webview
            this._panel.webview.postMessage({
                command: 'configLoaded',
                config: config
            });
        } catch (error) {
            // Config file doesn't exist or is invalid, use defaults
            console.log(`Config not found or invalid, using defaults: ${error}`);
            this._panel.webview.postMessage({
                command: 'configLoaded',
                config: this._getDefaultConfig()
            });
        }
    }

    private async _saveConfig(config: AicodecConfig) {
        const aicodecPath = getAicodecPath();
        if (!aicodecPath) {
            vscode.window.showErrorMessage('AIcodec path is not set. Please configure it first.');
            return;
        }

        const configPath = path.join(aicodecPath, 'config.json');

        try {
            // Ensure the .aicodec directory exists
            if (!fs.existsSync(aicodecPath)) {
                fs.mkdirSync(aicodecPath, { recursive: true });
                vscode.window.showInformationMessage(`Created AIcodec directory at: ${aicodecPath}`);
            }

            // Write the config file
            const configContent = JSON.stringify(config, null, 2);
            fs.writeFileSync(configPath, configContent, 'utf8');
            vscode.window.showInformationMessage('Configuration saved successfully!');
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to save config: ${error}`);
        }
    }

    private _getDefaultConfig(): AicodecConfig {
        // These defaults align with the aicodec init command defaults
        return {
            aggregate: {
                directories: ['.'],              // Default from init command
                exclude: [],                     // Default from init command
                include: [],                     // Default from init command
                plugins: [],                     // Default from init command
                use_gitignore: true              // Default from init command (YES)
            },
            prompt: {
                output_file: '.aicodec/prompt.txt',
                minimal: false,                  // Default from init command (NO)
                tech_stack: undefined,           // Optional field from init command
                include_map: false,              // Default from init command (NO)
                include_code: true,              // Default from init command (YES)
                clipboard: false                 // Always false as per requirement
            },
            prepare: {
                changes: '.aicodec/changes.json',
                from_clipboard: false            // Always false as per requirement
            },
            apply: {
                output_dir: '.'
            }
        };
    }

    private _mergeWithDefaults(loadedConfig: any): AicodecConfig {
        const defaults = this._getDefaultConfig();

        return {
            aggregate: {
                directories: loadedConfig.aggregate?.directories ?? defaults.aggregate.directories,
                exclude: loadedConfig.aggregate?.exclude ?? defaults.aggregate.exclude,
                include: loadedConfig.aggregate?.include ?? defaults.aggregate.include,
                plugins: loadedConfig.aggregate?.plugins ?? defaults.aggregate.plugins,
                use_gitignore: loadedConfig.aggregate?.use_gitignore ?? defaults.aggregate.use_gitignore
            },
            prompt: {
                output_file: loadedConfig.prompt?.output_file ?? defaults.prompt.output_file,
                minimal: loadedConfig.prompt?.minimal ?? defaults.prompt.minimal,
                tech_stack: loadedConfig.prompt?.tech_stack ?? defaults.prompt.tech_stack,
                include_map: loadedConfig.prompt?.include_map ?? defaults.prompt.include_map,
                include_code: loadedConfig.prompt?.include_code ?? defaults.prompt.include_code,
                clipboard: false  // Always false as per requirement
            },
            prepare: {
                changes: loadedConfig.prepare?.changes ?? defaults.prepare.changes,
                from_clipboard: false  // Always false as per requirement
            },
            apply: {
                output_dir: loadedConfig.apply?.output_dir ?? defaults.apply.output_dir
            }
        };
    }

    public dispose() {
        ConfigEditorPanel.currentPanel = undefined;

        // Clean up resources
        this._panel.dispose();

        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }

    private _update() {
        const webview = this._panel.webview;
        this._panel.webview.html = this._getHtmlForWebview(webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AIcodec Configuration</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            max-width: 900px;
            margin: 0 auto;
        }

        h1 {
            color: var(--vscode-foreground);
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 10px;
            margin-bottom: 20px;
        }

        h2 {
            color: var(--vscode-foreground);
            font-size: 1.3em;
            margin-top: 30px;
            margin-bottom: 15px;
            border-bottom: 1px solid var(--vscode-widget-border);
            padding-bottom: 5px;
        }

        .form-group {
            margin-bottom: 20px;
        }

        label {
            display: block;
            margin-bottom: 5px;
            font-weight: 500;
            color: var(--vscode-foreground);
        }

        .help-text {
            font-size: 0.9em;
            color: var(--vscode-descriptionForeground);
            margin-top: 3px;
        }

        input[type="text"],
        textarea {
            width: 100%;
            padding: 8px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            box-sizing: border-box;
        }

        textarea {
            min-height: 80px;
            resize: vertical;
        }

        input[type="text"]:focus,
        textarea:focus {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: -1px;
        }

        .checkbox-group {
            display: flex;
            align-items: center;
            margin-bottom: 15px;
        }

        input[type="checkbox"] {
            margin-right: 8px;
            width: 18px;
            height: 18px;
            cursor: pointer;
        }

        input[type="checkbox"]:disabled {
            cursor: not-allowed;
            opacity: 0.5;
        }

        .checkbox-group label {
            margin-bottom: 0;
            cursor: pointer;
            flex: 1;
        }

        .checkbox-group:has(input:disabled) label {
            cursor: not-allowed;
            opacity: 0.7;
        }

        .button-group {
            display: flex;
            gap: 10px;
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid var(--vscode-panel-border);
        }

        button {
            padding: 10px 20px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 14px;
            font-family: var(--vscode-font-family);
        }

        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        button.secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        button.secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        .array-input {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .array-item {
            display: flex;
            gap: 8px;
            align-items: center;
        }

        .array-item input {
            flex: 1;
        }

        .array-item button {
            padding: 5px 10px;
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .array-item button:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        .add-button {
            margin-top: 5px;
            padding: 5px 15px;
            font-size: 13px;
        }

        .section {
            background-color: var(--vscode-editor-background);
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 20px;
            border: 1px solid var(--vscode-widget-border);
        }
    </style>
</head>
<body>
    <h1>AIcodec Configuration Editor</h1>

    <form id="configForm">
        <!-- Aggregation Settings -->
        <div class="section">
            <h2>Aggregation Settings</h2>

            <div class="form-group">
                <label for="directories">Directories to Scan</label>
                <div id="directories" class="array-input"></div>
                <button type="button" class="add-button" onclick="addArrayItem('directories')">+ Add Directory</button>
                <div class="help-text">Directories to scan for files (e.g., ".", "src", "lib")</div>
            </div>

            <div class="checkbox-group">
                <input type="checkbox" id="use_gitignore" name="use_gitignore">
                <label for="use_gitignore">Use .gitignore</label>
            </div>
            <div class="help-text">Exclude files based on .gitignore patterns</div>

            <div class="form-group">
                <label for="include">Include Patterns</label>
                <div id="include" class="array-input"></div>
                <button type="button" class="add-button" onclick="addArrayItem('include')">+ Add Pattern</button>
                <div class="help-text">Glob patterns to always include (e.g., "*.md", "docs/**")</div>
            </div>

            <div class="form-group">
                <label for="exclude">Exclude Patterns</label>
                <div id="exclude" class="array-input"></div>
                <button type="button" class="add-button" onclick="addArrayItem('exclude')">+ Add Pattern</button>
                <div class="help-text">Glob patterns to exclude (e.g., "*.log", "dist/", ".gitignore")</div>
            </div>

            <div class="form-group">
                <label for="plugins">Plugins</label>
                <div id="plugins" class="array-input"></div>
                <button type="button" class="add-button" onclick="addPluginItem()">+ Add Plugin</button>
                <div class="help-text">Custom file plugins (format: extension=command, e.g., ".sh=bash")</div>
            </div>
        </div>

        <!-- LLM Interaction Settings -->
        <div class="section">
            <h2>LLM Interaction Settings</h2>

            <div class="checkbox-group">
                <input type="checkbox" id="minimal" name="minimal">
                <label for="minimal">Use Minimal Prompt Template</label>
            </div>
            <div class="help-text">Reduces context size (might influence results)</div>

            <div class="form-group">
                <label for="tech_stack">Tech Stack (Optional)</label>
                <input type="text" id="tech_stack" name="tech_stack" placeholder="e.g., Python, TypeScript/React, Go">
                <div class="help-text">Primary programming language or technology stack</div>
            </div>

            <div class="checkbox-group">
                <input type="checkbox" id="include_map" name="include_map">
                <label for="include_map">Include Repository Map</label>
            </div>
            <div class="help-text">Include repository map in prompt by default</div>

            <div class="checkbox-group">
                <input type="checkbox" id="include_code" name="include_code">
                <label for="include_code">Include Code Context</label>
            </div>
            <div class="help-text">Whether to include code in prompt by default</div>

            <div class="checkbox-group">
                <input type="checkbox" id="from_clipboard" name="from_clipboard" disabled>
                <label for="from_clipboard">Read LLM Output from Clipboard (Always Disabled)</label>
            </div>
            <div class="help-text">This feature is disabled in the extension - use file-based workflow instead</div>

            <div class="checkbox-group">
                <input type="checkbox" id="clipboard" name="clipboard" disabled>
                <label for="clipboard">Copy Prompt to Clipboard (Always Disabled)</label>
            </div>
            <div class="help-text">This feature is disabled in the extension - use file-based workflow instead</div>
        </div>

        <!-- File Path Settings -->
        <div class="section">
            <h2>File Path Settings</h2>

            <div class="form-group">
                <label for="output_file">Prompt Output File</label>
                <input type="text" id="output_file" name="output_file" value=".aicodec/prompt.txt">
                <div class="help-text">Where to write the generated prompt</div>
            </div>

            <div class="form-group">
                <label for="changes">Changes File</label>
                <input type="text" id="changes" name="changes" value=".aicodec/changes.json">
                <div class="help-text">Where to read LLM changes from</div>
            </div>

            <div class="form-group">
                <label for="output_dir">Apply Output Directory</label>
                <input type="text" id="output_dir" name="output_dir" value=".">
                <div class="help-text">Where to apply changes</div>
            </div>
        </div>

        <div class="button-group">
            <button type="button" onclick="saveConfig()">Save Configuration</button>
            <button type="button" class="secondary" onclick="loadConfig()">Reset to Current</button>
        </div>
    </form>

    <script>
        const vscode = acquireVsCodeApi();

        // Load config on startup
        window.addEventListener('load', () => {
            loadConfig();
        });

        // Listen for messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'configLoaded':
                    populateForm(message.config);
                    break;
            }
        });

        function loadConfig() {
            vscode.postMessage({ command: 'load' });
        }

        function saveConfig() {
            const config = collectFormData();
            vscode.postMessage({ command: 'save', config: config });
        }

        function populateForm(config) {
            // Aggregation
            populateArrayField('directories', config.aggregate.directories || ['.']);
            document.getElementById('use_gitignore').checked = config.aggregate.use_gitignore ?? true;
            populateArrayField('include', config.aggregate.include || []);
            populateArrayField('exclude', config.aggregate.exclude || []);
            populatePluginField('plugins', config.aggregate.plugins || []);

            // LLM Interaction
            document.getElementById('minimal').checked = config.prompt.minimal ?? false;
            document.getElementById('tech_stack').value = config.prompt.tech_stack || '';
            document.getElementById('include_map').checked = config.prompt.include_map ?? false;
            document.getElementById('include_code').checked = config.prompt.include_code ?? true;
            document.getElementById('from_clipboard').checked = config.prepare.from_clipboard ?? false;
            document.getElementById('clipboard').checked = config.prompt.clipboard ?? false;

            // File Paths
            document.getElementById('output_file').value = config.prompt.output_file || '.aicodec/prompt.txt';
            document.getElementById('changes').value = config.prepare.changes || '.aicodec/changes.json';
            document.getElementById('output_dir').value = config.apply.output_dir || '.';
        }

        function collectFormData() {
            return {
                aggregate: {
                    directories: getArrayFieldValues('directories'),
                    exclude: getArrayFieldValues('exclude'),
                    include: getArrayFieldValues('include'),
                    plugins: getPluginFieldValues('plugins'),
                    use_gitignore: document.getElementById('use_gitignore').checked
                },
                prompt: {
                    output_file: document.getElementById('output_file').value,
                    minimal: document.getElementById('minimal').checked,
                    tech_stack: document.getElementById('tech_stack').value || undefined,
                    include_map: document.getElementById('include_map').checked,
                    include_code: document.getElementById('include_code').checked,
                    clipboard: document.getElementById('clipboard').checked
                },
                prepare: {
                    changes: document.getElementById('changes').value,
                    from_clipboard: document.getElementById('from_clipboard').checked
                },
                apply: {
                    output_dir: document.getElementById('output_dir').value
                }
            };
        }

        function populateArrayField(fieldId, values) {
            const container = document.getElementById(fieldId);
            container.innerHTML = '';

            if (values.length === 0) {
                addArrayItem(fieldId);
            } else {
                values.forEach(value => {
                    addArrayItem(fieldId, value);
                });
            }
        }

        function addArrayItem(fieldId, value = '') {
            const container = document.getElementById(fieldId);
            const itemDiv = document.createElement('div');
            itemDiv.className = 'array-item';

            const input = document.createElement('input');
            input.type = 'text';
            input.value = value;
            input.className = 'array-value';

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.textContent = 'Remove';
            removeBtn.onclick = () => {
                const items = container.querySelectorAll('.array-item');
                if (items.length > 1) {
                    itemDiv.remove();
                } else {
                    input.value = '';
                }
            };

            itemDiv.appendChild(input);
            itemDiv.appendChild(removeBtn);
            container.appendChild(itemDiv);
        }

        function getArrayFieldValues(fieldId) {
            const container = document.getElementById(fieldId);
            const inputs = container.querySelectorAll('.array-value');
            return Array.from(inputs)
                .map(input => input.value.trim())
                .filter(value => value !== '');
        }

        function populatePluginField(fieldId, plugins) {
            const container = document.getElementById(fieldId);
            container.innerHTML = '';

            if (plugins.length === 0) {
                addPluginItem();
            } else {
                plugins.forEach(plugin => {
                    addPluginItem(plugin.extension, plugin.command);
                });
            }
        }

        function addPluginItem(extension = '', command = '') {
            const container = document.getElementById('plugins');
            const itemDiv = document.createElement('div');
            itemDiv.className = 'array-item';

            const extInput = document.createElement('input');
            extInput.type = 'text';
            extInput.value = extension;
            extInput.placeholder = '.ext';
            extInput.className = 'plugin-extension';
            extInput.style.flex = '0 0 100px';

            const cmdInput = document.createElement('input');
            cmdInput.type = 'text';
            cmdInput.value = command;
            cmdInput.placeholder = 'command {file}';
            cmdInput.className = 'plugin-command';
            cmdInput.style.flex = '1';

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.textContent = 'Remove';
            removeBtn.onclick = () => {
                const items = container.querySelectorAll('.array-item');
                if (items.length > 1) {
                    itemDiv.remove();
                } else {
                    extInput.value = '';
                    cmdInput.value = '';
                }
            };

            itemDiv.appendChild(extInput);
            itemDiv.appendChild(cmdInput);
            itemDiv.appendChild(removeBtn);
            container.appendChild(itemDiv);
        }

        function getPluginFieldValues(fieldId) {
            const container = document.getElementById(fieldId);
            const items = container.querySelectorAll('.array-item');
            const plugins = [];

            items.forEach(item => {
                const ext = item.querySelector('.plugin-extension').value.trim();
                const cmd = item.querySelector('.plugin-command').value.trim();
                if (ext && cmd) {
                    plugins.push({ extension: ext, command: cmd });
                }
            });

            return plugins;
        }
    </script>
</body>
</html>`;
    }
}

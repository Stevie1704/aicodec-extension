# AIcodec GUI for VSCode

A Visual Studio Code extension that provides a graphical user interface for the [aicodec CLI tool](https://github.com/Stevie1704/aicodec). AIcodec helps you work with Large Language Models (LLMs) by managing code context, generating prompts, and applying AI-suggested changes to your codebase.

## Features

- **Context Management**: Browse and manage files in your AI context via the Aggregates view
- **Visual Diff**: Preview changes before applying them with side-by-side diff views
- **Change Management**: Apply or revert individual changes or all changes at once
- **Revert History**: Track and revert previously applied changes
- **Configuration Editor**: User-friendly GUI for editing aicodec configuration
- **Command Palette Integration**: Access all aicodec commands via F1 (all prefixed with "AIcodec:")

### Available Commands

- **AIcodec: Aggregate** - Scan your codebase and build context
- **AIcodec: Aggregate (Force Rehash)** - Force rebuild of all file hashes
- **AIcodec: Build Repository Map** - Generate a map of your repository structure
- **AIcodec: Generate Prompt** - Create a prompt file for LLM interaction
- **AIcodec: Prepare Changes** - Prepare LLM-suggested changes for review
- **AIcodec: Show JSON Schema** - Display the JSON schema for LLM change proposals
- **AIcodec: Edit Configuration** - Open the visual configuration editor
- **AIcodec: Set .aicodec Directory Path** - Configure the .aicodec directory location
- **AIcodec: Cleanup Temporary Files** - Remove temporary diff files

## Requirements

### Required
- **aicodec CLI v2.9.0 or higher**: This extension requires the aicodec CLI tool to be installed
  - **Minimum version**: 2.9.0
  - Install via: `curl -sSL https://raw.githubusercontent.com/Stevie1704/aicodec/main/scripts/install.sh | bash` (Linux/macOS)
  - Or: `powershell -Command "irm https://raw.githubusercontent.com/Stevie1704/aicodec/main/scripts/install.ps1 | iex"` (Windows)
  - Or install manually from [GitHub](https://github.com/Stevie1704/aicodec)
  - Check your version: `aicodec --version`

### Optional
- The extension will prompt you to install the CLI if not found
- You can specify a custom CLI path in settings if not in PATH

## Getting Started

1. Install the extension
2. Install the aicodec CLI (see Requirements above)
3. Open a workspace/folder in VSCode
4. Open the AIcodec sidebar (click the beaker icon in the activity bar)
5. Click the gear icon to configure your project or run any command to auto-create a default config
6. Run **AIcodec: Aggregate** to scan your codebase
7. Run **AIcodec: Generate Prompt** to create a prompt for your LLM
8. After getting changes from your LLM, use **AIcodec: Prepare Changes** to load them
9. Preview changes in the Changes view and apply or revert as needed

## Extension Settings

This extension contributes the following settings:

- `aicodec.path`: The absolute path to the .aicodec directory for your project (workspace-specific)
- `aicodec.cliPath`: Path to the aicodec CLI executable (default: "aicodec" to use PATH)
- `aicodec.useCli`: Use the aicodec CLI for operations (recommended, default: true)

## Typical Workflow

1. **Aggregate**: Scan your codebase to build context
2. **Generate Prompt**: Create a prompt file with your coding task
3. **LLM Interaction**: Copy the prompt to your LLM (Claude, GPT, etc.)
4. **Prepare Changes**: Paste the LLM's JSON response
5. **Review**: Preview changes in diff view
6. **Apply**: Apply changes you approve
7. **Revert**: Roll back changes if needed

## Known Issues

- Requires the aicodec CLI to be installed separately
- The visual config editor requires manual save (click "Save Configuration" button)

## Release Notes

### 0.1.0 - Initial Release

- Full VSCode GUI for aicodec CLI
- Three views: Aggregates, Changes, and Reverts
- Visual configuration editor
- Diff preview for all changes
- Command palette integration for all CLI commands
- Automatic config.json creation
- Temporary file cleanup

## More Information

- [Extension Repository](https://github.com/Stevie1704/aicodec-extension)
- [aicodec CLI Repository](https://github.com/Stevie1704/aicodec)
- [Report Issues](https://github.com/Stevie1704/aicodec-extension/issues)
- [CLI Documentation](https://github.com/Stevie1704/aicodec#readme)

## License

MIT

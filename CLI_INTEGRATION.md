# AIcodec Extension - CLI Integration

The AIcodec VSCode extension integrates with the aicodec CLI tool for full-featured apply/revert operations with session management.

## Features

### CLI-Powered Operations (Recommended)
When the aicodec CLI is installed and available:
- ✅ **Session Management** - Creates unique session IDs for each apply operation
- ✅ **Automatic Revert Data** - Generates revert.json files before applying changes
- ✅ **File Filtering** - Apply/revert specific files using `--files` flag
- ✅ **Robust Error Handling** - Full CLI validation and error reporting
- ✅ **Consistent Behavior** - Matches CLI functionality exactly

### Built-in Fallback
When CLI is not available or disabled:
- ⚠️ **Basic Apply/Revert** - Simple file content replacement
- ❌ **No Session Management** - No session IDs or tracking
- ❌ **No Revert Data** - Does not create revert.json files
- ⚠️ **Limited Error Handling** - Basic file write operations only

## Installation

### Option 1: Install via Extension (Recommended)
1. When you first use apply/revert, the extension will prompt you
2. Click **"Install aicodec CLI"**
3. The installation script will run in a terminal
4. After installation completes, reload the window

### Option 2: Manual Installation

#### Linux / macOS
```bash
curl -sSL https://raw.githubusercontent.com/Stevie1704/aicodec/main/scripts/install.sh | bash
```

#### Windows
```powershell
powershell -Command "irm https://raw.githubusercontent.com/Stevie1704/aicodec/main/scripts/install.ps1 | iex"
```

#### Python pip (if available)
```bash
pip install aicodec
```

### Option 3: Specify Custom Path
1. Open VSCode Settings (Ctrl+, / Cmd+,)
2. Search for "aicodec"
3. Set **AIcodec: Cli Path** to your aicodec executable path
   - Default: `aicodec` (uses PATH)
   - Custom: `/path/to/your/aicodec`

## Configuration

### Settings

#### `aicodec.cliPath` (string)
- **Default**: `"aicodec"`
- **Description**: Path to the aicodec CLI executable
- **Scope**: Machine (global)
- **Usage**:
  - `"aicodec"` - Use aicodec from system PATH
  - `"/usr/local/bin/aicodec"` - Use specific path
  - `"C:\\Program Files\\aicodec\\aicodec.exe"` - Windows example

#### `aicodec.useCli` (boolean)
- **Default**: `true`
- **Description**: Use CLI for apply/revert operations
- **Scope**: Workspace
- **Usage**:
  - `true` - Use CLI when available (recommended)
  - `false` - Always use built-in TypeScript implementation

#### `aicodec.path` (string)
- **Default**: `""`
- **Description**: Path to the .aicodec directory
- **Scope**: Workspace
- **Usage**: Set automatically via the "Set Path" button in the extension

## Usage

### Apply/Revert Single File
1. Open the **Changes** or **Reverts** view
2. Right-click on a file
3. Click **Apply** or **Revert**
4. The extension will:
   - Try to use CLI if available
   - Show installation prompt if CLI not found
   - Fall back to built-in implementation if you choose

### Apply/Revert All Files
1. Click the **Apply All** or **Revert All** button in the view toolbar
2. Progress notification will show
3. Success/failure message displays when complete

## CLI Detection Flow

The extension follows this order to find the CLI:

1. **User Configuration** - Checks `aicodec.cliPath` setting
2. **System PATH** - Searches for `aicodec` in PATH
3. **Prompt User** - Shows installation/configuration options if not found

## Troubleshooting

### CLI Not Found
**Symptom**: Warning message "aicodec CLI not found"

**Solutions**:
1. Install CLI via the extension prompt
2. Install manually (see Installation above)
3. Set custom path in settings
4. Use built-in fallback (limited features)

### CLI Found But Not Working
**Symptom**: Commands fail with errors

**Solutions**:
1. Verify CLI is executable: `aicodec --version`
2. Check file permissions: `chmod +x /path/to/aicodec`
3. Verify CLI is in PATH: `which aicodec` (Linux/macOS) or `where aicodec` (Windows)
4. Check settings for correct path

### Using Built-in Implementation
**Symptom**: Want to use TypeScript fallback permanently

**Solution**:
1. Open Settings
2. Disable **AIcodec: Use Cli**
3. Extension will always use built-in implementation

## Comparison: CLI vs Built-in

| Feature | CLI | Built-in |
|---------|-----|----------|
| Apply changes | ✅ Full | ✅ Basic |
| Revert changes | ✅ Full | ✅ Basic |
| Session management | ✅ Yes | ❌ No |
| Create revert.json | ✅ Yes | ❌ No |
| File filtering (--files) | ✅ Yes | ❌ No |
| Error reporting | ✅ Detailed | ⚠️ Basic |
| Speed | ⚠️ Process spawn | ✅ Direct |
| Dependencies | ⚠️ Needs CLI | ✅ None |

## Development

### Testing CLI Integration

1. **With CLI installed**:
   ```bash
   # Test CLI is found
   aicodec --version

   # Run extension in debug mode
   # Try apply/revert operations
   ```

2. **Without CLI**:
   ```bash
   # Temporarily rename CLI
   mv /usr/local/bin/aicodec /usr/local/bin/aicodec.bak

   # Test fallback behavior
   # Restore when done
   mv /usr/local/bin/aicodec.bak /usr/local/bin/aicodec
   ```

### Adding New CLI Commands

To integrate a new CLI command:

1. Add function to `cliIntegration.ts`:
   ```typescript
   export async function newCommandViaCli(
       cliPath: string,
       args: string[]
   ): Promise<CliResult> {
       return executeCliCommand(cliPath, ['new-command', ...args]);
   }
   ```

2. Update commands in `commands.ts`:
   ```typescript
   import { newCommandViaCli } from './cliIntegration';

   const { available, cliPath } = await ensureCliAvailable();
   if (available && cliPath) {
       await newCommandViaCli(cliPath, args);
   }
   ```

## Support

For issues related to:
- **CLI installation**: Check [CLI documentation](https://github.com/Stevie1704/aicodec)
- **Extension functionality**: Open issue in extension repository
- **CLI commands**: Run with `--help` flag or check CLI docs

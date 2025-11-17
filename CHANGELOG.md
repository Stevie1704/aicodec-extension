# Change Log

All notable changes to the AIcodec VSCode extension will be documented in this file.

## [0.1.0] - 2025-11-17

### Added
- Initial release of AIcodec GUI for VSCode
- **Requires aicodec CLI v2.9.0 or higher**
- Three main views: Aggregates, Changes, and Reverts
- Visual configuration editor for config.json
- Diff preview for all changes before applying
- Command palette integration for all CLI commands (F1 → "AIcodec:")
- Automatic config.json creation when running commands
- CLI integration with installation helpers
- Temporary file cleanup on startup and editor close
- Manual cleanup command for temporary files
- Support for viewing changes to non-existent files (new file creation)
- Virtual file system for readonly and empty file views

### Commands
- AIcodec: Aggregate - Scan codebase and build context
- AIcodec: Aggregate (Force Rehash) - Force rebuild of all file hashes
- AIcodec: Build Repository Map - Generate repository structure map
- AIcodec: Generate Prompt - Create prompt file for LLM interaction
- AIcodec: Prepare Changes - Load and validate LLM-suggested changes
- AIcodec: Show JSON Schema - Display JSON schema for change proposals
- AIcodec: Edit Configuration - Open visual config editor
- AIcodec: Set .aicodec Directory Path - Configure project directory
- AIcodec: Cleanup Temporary Files - Remove temporary diff files

### Features
- Context management via Aggregates view
- Change preview and management via Changes view
- Revert history and rollback via Reverts view
- One-click apply/revert for individual files
- Bulk apply/revert all changes
- Inline file removal from context
- Settings integration for CLI path and project configuration

## [Unreleased]

### Planned
- Screenshots and demo GIFs for README
- Extension icon
- Marketplace publication
- User feedback integration
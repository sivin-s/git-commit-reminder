"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
function activate(context) {
    console.log('Git Commit Reminder is now active!');
    const modifiedFiles = new Map();
    let snoozeState = null;
    // Get configuration
    function getConfig() {
        return {
            enableOnSave: vscode.workspace.getConfiguration('gitCommitReminder').get('enableOnSave', true),
            enableOnClose: vscode.workspace.getConfiguration('gitCommitReminder').get('enableOnClose', true),
            enableOnSwitch: vscode.workspace.getConfiguration('gitCommitReminder').get('enableOnSwitch', false),
            minChanges: vscode.workspace.getConfiguration('gitCommitReminder').get('minChanges', 1),
            snoozeMinutes: vscode.workspace.getConfiguration('gitCommitReminder').get('snoozeMinutes', 10),
            showDiffPreview: vscode.workspace.getConfiguration('gitCommitReminder').get('showDiffPreview', true),
        };
    }
    // Check if file is in a git repository
    async function isGitRepository(filePath) {
        try {
            const dir = path.dirname(filePath);
            await execAsync('git rev-parse --is-inside-work-tree', { cwd: dir });
            return true;
        }
        catch {
            return false;
        }
    }
    // Get git status for a file
    async function getFileGitStatus(filePath) {
        try {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
            if (!workspaceFolder)
                return null;
            const relativePath = path.relative(workspaceFolder.uri.fsPath, filePath);
            const { stdout } = await execAsync(`git status --porcelain "${relativePath}"`, {
                cwd: workspaceFolder.uri.fsPath
            });
            return stdout.trim();
        }
        catch {
            return null;
        }
    }
    // Check if snoozed
    function isSnoozed() {
        if (!snoozeState)
            return false;
        if (Date.now() > snoozeState.until) {
            snoozeState = null;
            return false;
        }
        return true;
    }
    // Get remaining snooze time in minutes
    function getSnoozeRemainingMinutes() {
        if (!snoozeState)
            return 0;
        return Math.max(0, Math.ceil((snoozeState.until - Date.now()) / 60000));
    }
    // Track file changes
    function trackFileChange(document) {
        const filePath = document.uri.fsPath;
        if (document.isDirty) {
            const existing = modifiedFiles.get(filePath);
            modifiedFiles.set(filePath, {
                uri: filePath,
                lastReminderTime: existing?.lastReminderTime || 0,
                changeCount: (existing?.changeCount || 0) + 1
            });
        }
    }
    // Show reminder with options
    async function showReminder(document, trigger) {
        const config = getConfig();
        const filePath = document.uri.fsPath;
        // Check if snoozed
        if (isSnoozed()) {
            const remaining = getSnoozeRemainingMinutes();
            vscode.window.setStatusBarMessage(`Git Commit Reminder snoozed (${remaining} min remaining)`, 3000);
            return;
        }
        // Check if file is in git repo
        const isGit = await isGitRepository(filePath);
        if (!isGit)
            return;
        // Get file info
        const fileInfo = modifiedFiles.get(filePath);
        if (!fileInfo || fileInfo.changeCount < config.minChanges)
            return;
        // Get file name for display
        const fileName = path.basename(filePath);
        const changeCount = fileInfo.changeCount;
        // Build message
        const triggerText = trigger === 'save' ? 'saved' : trigger === 'close' ? 'closing' : 'leaving';
        const message = `📋 You've made ${changeCount} change(s) to "${fileName}" after ${triggerText}. Would you like to commit?`;
        // Build buttons
        const buttons = ['Commit Now', 'Snooze', 'Dismiss'];
        if (config.showDiffPreview) {
            buttons.splice(1, 0, 'View Diff');
        }
        // Show info message
        const selection = await vscode.window.showInformationMessage(message, ...buttons);
        // Handle selection
        switch (selection) {
            case 'Commit Now':
                await openCommitPanel(document);
                break;
            case 'View Diff':
                await showDiff(document);
                // Show reminder again after diff
                const afterDiffSelection = await vscode.window.showInformationMessage(`Would you like to commit "${fileName}" now?`, 'Commit Now', 'Snooze', 'Dismiss');
                if (afterDiffSelection === 'Commit Now') {
                    await openCommitPanel(document);
                }
                else if (afterDiffSelection === 'Snooze') {
                    snoozeState = { until: Date.now() + config.snoozeMinutes * 60 * 1000 };
                    vscode.window.showInformationMessage(`Reminder snoozed for ${config.snoozeMinutes} minutes`);
                }
                break;
            case 'Snooze':
                snoozeState = { until: Date.now() + config.snoozeMinutes * 60 * 1000 };
                vscode.window.showInformationMessage(`Reminder snoozed for ${config.snoozeMinutes} minutes`);
                break;
            case 'Dismiss':
            case undefined:
                // Do nothing
                break;
        }
        // Update last reminder time
        if (fileInfo) {
            fileInfo.lastReminderTime = Date.now();
        }
    }
    // Open commit panel (source control view)
    async function openCommitPanel(document) {
        // Stage the file
        try {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
            if (workspaceFolder) {
                const relativePath = path.relative(workspaceFolder.uri.fsPath, document.uri.fsPath);
                await execAsync(`git add "${relativePath}"`, { cwd: workspaceFolder.uri.fsPath });
                vscode.window.showInformationMessage(`Staged: ${relativePath}`);
            }
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to stage file: ${error}`);
        }
        // Focus on source control view
        await vscode.commands.executeCommand('workbench.view.scm');
        // Focus on commit message input
        await vscode.commands.executeCommand('scm.focus');
    }
    // Show diff for the file
    async function showDiff(document) {
        try {
            await vscode.commands.executeCommand('git.openChange', document.uri);
        }
        catch {
            // Fallback: open diff editor manually
            vscode.commands.executeCommand('vscode.diff', document.uri, document.uri.with({ scheme: 'git' }), `${path.basename(document.uri.fsPath)} (Working Tree ↔ Git)`);
        }
    }
    // ============ EVENT LISTENERS ============
    // Listen for document changes (to track modifications)
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => {
        trackFileChange(event.document);
    }));
    // Listen for document save
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async (document) => {
        const config = getConfig();
        if (!config.enableOnSave)
            return;
        if (document.languageId === 'log' || document.languageId === 'output')
            return;
        if (document.isUntitled)
            return;
        await showReminder(document, 'save');
    }));
    // Listen for document close
    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(async (document) => {
        const config = getConfig();
        if (!config.enableOnClose)
            return;
        if (document.languageId === 'log' || document.languageId === 'output')
            return;
        if (document.isUntitled)
            return;
        // Check if file had changes
        const filePath = document.uri.fsPath;
        const fileInfo = modifiedFiles.get(filePath);
        if (fileInfo && fileInfo.changeCount >= config.minChanges) {
            await showReminder(document, 'close');
        }
        // Clean up
        modifiedFiles.delete(filePath);
    }));
    // Listen for active editor change (file switch)
    let previousActiveEditor;
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(async (editor) => {
        const config = getConfig();
        if (!config.enableOnSwitch)
            return;
        if (!previousActiveEditor) {
            previousActiveEditor = editor;
            return;
        }
        const previousDocument = previousActiveEditor.document;
        previousActiveEditor = editor;
        if (previousDocument.isUntitled)
            return;
        if (previousDocument.languageId === 'log' || previousDocument.languageId === 'output')
            return;
        // Check if file had changes
        const filePath = previousDocument.uri.fsPath;
        const fileInfo = modifiedFiles.get(filePath);
        if (fileInfo && fileInfo.changeCount >= config.minChanges) {
            await showReminder(previousDocument, 'switch');
        }
    }));
    // ============ COMMANDS ============
    // Manual commit reminder command
    context.subscriptions.push(vscode.commands.registerCommand('gitCommitReminder.showReminder', async () => {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            vscode.window.showWarningMessage('No active file');
            return;
        }
        await showReminder(activeEditor.document, 'save');
    }));
    // Reset snooze command
    context.subscriptions.push(vscode.commands.registerCommand('gitCommitReminder.resetSnooze', () => {
        snoozeState = null;
        vscode.window.showInformationMessage('Snooze reset - reminders are now active');
    }));
    // Clear tracked changes command
    context.subscriptions.push(vscode.commands.registerCommand('gitCommitReminder.clearTracked', () => {
        modifiedFiles.clear();
        vscode.window.showInformationMessage('Tracked changes cleared');
    }));
    // Show status command
    context.subscriptions.push(vscode.commands.registerCommand('gitCommitReminder.showStatus', () => {
        const snoozed = isSnoozed();
        const changeCount = modifiedFiles.size;
        let message = `📊 Git Commit Reminder Status:\n`;
        message += `• Tracked files with changes: ${changeCount}\n`;
        message += `• Snoozed: ${snoozed ? `Yes (${getSnoozeRemainingMinutes()} min remaining)` : 'No'}`;
        vscode.window.showInformationMessage(message);
    }));
}
function deactivate() {
    console.log('Git Commit Reminder deactivated');
}
//# sourceMappingURL=extension.js.map
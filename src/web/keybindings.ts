import * as vscode from 'vscode';
import { searchMatches } from './searching';
import { BindingItem, parseBindingFile, showParseError } from './keybindingParsing';
import { processBindings } from './keybindingProcessing';
import { pick } from 'lodash';

////////////////////////////////////////////////////////////////////////////////////////////
// Keybinding Generation

const AUTOMATED_COMMENT_START_PREFIX = `
    // AUTOMATED BINDINGS START: ModalKey Bindings 
    //
    // These bindings were automatically inserted by the ModalKeys extension from the
    // following file: 
    //
`;

const AUTOMATED_COMMENT_START_SUFFIX = `
    //
    // Leave this comment (and the one denoting the end) unmodified to ensure the automated
    // bindings are properly updated if/when you insert another preset. Add any additional
    // bindings you want *outside* of the automated bindings region as it will be modified
    // when new presets are imported.
`;

const AUTOMATED_COMMENT_END = `
    // AUTOMATED BINDINGS END: ModalKey Bindings

    // Leave this comment (and the one denoting the start) unmodified to ensure the
    // automated bindings are properly updated if/when you insert another preset
`;

function findText(doc: vscode.TextDocument, text: string) {
    let matches = searchMatches(doc, new vscode.Position(0, 0), undefined, text, {});
    let firstMatchResult = matches.next();
    if (firstMatchResult.done) { return undefined; }

    return firstMatchResult.value;
}

function replaceAll(str: string, regex: RegExp, replacement: string): string {
    let result = "";
    if(!/g/.test(regex.flags)){
        throw(Error(`Expected a 'g' flag for regex ${regex}`));
    }
    let m = regex.exec(str);
    let offset = 0;
    while(m !== null){
        result += str.slice(offset, m.index);
        result += replacement;
        offset += m[0].length;
        m = regex.exec(str);
    }
    return result + str.slice(offset, -1);
}

function formatBindings(file: vscode.Uri, items: BindingItem[]){
    let json = "";
    for(let item of items){
        let comment = "";
        if(item.name !== undefined && item.description !== undefined){
            comment += `${item.name}: ${item.description}`;
        }else if(item.name !== undefined){
            comment += item.name;
        }else if(item.description !== undefined){
            comment += item.description;
        }

        json += replaceAll(comment, /^\s*(?=\S+)/mg, "    // ")+"\n";
        json += replaceAll(JSON.stringify(pick(item, ['key', 'when', 'command', 'args']), 
            null, 4), /^/mg, "    ");
        json += ",\n\n";
    }
    return (
        AUTOMATED_COMMENT_START_PREFIX+
        "    // `"+file.toString()+"`"+
        AUTOMATED_COMMENT_START_SUFFIX+
        "\n" + json +
        AUTOMATED_COMMENT_END
    );
}

async function insertKeybindingsIntoConfig(file: vscode.Uri, config: any) {
    await vscode.commands.executeCommand('workbench.action.openGlobalKeybindingsFile');
    let ed = vscode.window.activeTextEditor;
    if (ed){
        let bracket = findText(ed.document, "[");
        if (!bracket) {
            vscode.window.showErrorMessage("Could not find opening `[` at top of " +
                "keybindings file. Your keybinding file does not appear to be " +
                "proplery formatted.");
            return;
        } else {
            let insertAt = bracket.end;
            let bindingsToInsert = formatBindings(file, config);

            // try and replace the old bindings
            let oldBindingsStart = findText(ed.document, "AUTOMATED BINDINGS START");
            let oldBindingsEnd = findText(ed.document, "AUTOMATED BINDINGS END");
            ed.document.getText(oldBindingsStart);
            if (oldBindingsStart && oldBindingsEnd) {
                let range = new vscode.Range(
                    new vscode.Position(oldBindingsStart.start.line-1, 
                                        ed.document.lineAt(oldBindingsStart.start.line-1).range.end.character),
                    new vscode.Position(oldBindingsEnd.end.line + 4, 0));
                await ed.edit(builder => {
                    builder.replace(range, bindingsToInsert);
                });
                // TODO: uncomment after debugging
                // vscode.commands.executeCommand('workbench.action.files.save');
                vscode.window.showInformationMessage(`Your modal key bindings have
                    been updated in \`keybindings.json\`.`);
            } else if (oldBindingsEnd || oldBindingsStart){
                vscode.window.showErrorMessage(`You appear to have altered the comments
                    around the automated bindings. Please delete the old, automated
                    bindings manually and then re-run this command.`);
            }else {
                // if there are no old bindings, insert new ones
                await ed.edit(builder => {
                    builder.insert(insertAt, "\n" + bindingsToInsert);
                });
                // TODO: uncomment after debugging 
                // TODO: also have the cursor moved to the start of the 
                // automated bindings
                // vscode.commands.executeCommand('workbench.action.files.save');
                vscode.window.showInformationMessage(`Your modal key bindings have
                    been inserted into \`keybindings.json\`.`);
            }
        }
    }
}


////////////////////////////////////////////////////////////////////////////////////////////
// User-facing commands and helpers

async function queryBindingFile() {
    // TODO: improve this interface; there should be some predefined set of presets and you
    // can add your own to the list (these can get saved using globalStorageUri)
    let file = await vscode.window.showOpenDialog({
        openLabel: "Import Modal-Key-Binding Spec",
        // eslint-disable-next-line @typescript-eslint/naming-convention
        filters: { Preset: ["json", "toml"] },
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false
    });
    if(!file || file.length !== 1) { return undefined; }
    return file[0];
}

async function importBindings() {
    let file = await queryBindingFile();
    if (file === undefined) { return; }
    let parsedBindings = await parseBindingFile(file);
    if(parsedBindings.success){
        let bindings = processBindings(parsedBindings.data);
        insertKeybindingsIntoConfig(file, bindings);
        let newValidModes = parsedBindings.data.define?.validModes;
        if(newValidModes){
            let config = vscode.workspace.getConfiguration('modalkeys');
            config.update('validModes', newValidModes, vscode.ConfigurationTarget.Global);
        }
    }else{
        for (let issue of parsedBindings.error.issues.slice(0, 3)) {
            showParseError("Parsing of bindings failed: ", issue);
        }
    }
}

// TODO: we also evenutally want to have a way to customize presets
// replacementout having to modify it (for small tweaks)
// TODO: we want to be able to export a preset to a file
// TODO: we should be able to delete user defined presets

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.commands.registerCommand(
        'modalkeys.importBindings',
        importBindings
    ));
}

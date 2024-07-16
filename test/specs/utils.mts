import { browser, expect } from '@wdio/globals';
import 'wdio-vscode-service';
import { Key, WaitUntilOptions } from 'webdriverio';
import { Input, InputBox, StatusBar, TextEditor, Workbench, sleep } from 'wdio-vscode-service';
import loadash from 'lodash';
const { isEqual } = loadash;
import * as fs from 'fs';
import * as path from 'path';

const COVERAGE_KEY_COMMAND = `
[[bind]]
name = "show coverage"
key = "ctrl+shift+alt+c"
mode = []
prefixes = "<all-prefixes>"
command = "master-key.writeCoverageToEditor"
`;

export async function setBindings(str: string){
    await setupEditor(str + COVERAGE_KEY_COMMAND);

    const workbench = await browser.getWorkbench();
    await workbench.executeCommand('Select Language Mode');
    let input = await ((new InputBox(workbench.locatorMap)).wait());
    await input.setText("Markdown");
    await input.confirm();

    await workbench.executeCommand('Master key: Activate Keybindings');
    let bindingInput = await ((new InputBox(workbench.locatorMap)).wait());
    await bindingInput.setText("Current File");
    await bindingInput.confirm();

    const messagePattern = /Your master keybindings have/;
    let message = await browser.waitUntil(async () => {
        const notifs = await workbench.getNotifications();
        if(notifs.length > 0){
            for(let not of notifs){
                const m = await not.getMessage();
                if(messagePattern.test(m)){
                    return m;
                }else{
                    console.log("[UTIL]: notification message — "+m);
                }
            }
        }else{
            return false;
        }
    });
    expect(message).toBeTruthy();
    // downstream tests appear to sometimes be flaky by failing to respond
    // to bindings appropriately, given vscode some time to actually load/
    // respond to the new bindings
    await sleep(2000);
    return;
}

export async function storeCoverageStats(name: string){
    if(!process.env.COVERAGE){ return; }
    const editor = await setupEditor("");
    // TODO: not sure why the keys don't show up in the status bar here...
    // (probably a bug)
    await enterModalKeys({key: ['ctrl', 'shift', 'alt', 'c'], updatesStatus: false});

    await sleep(1000);
    await waitUntilCursorUnmoving(editor);

    let coverageStr = await editor.getText();
    fs.writeFileSync(
        path.join(process.env.COVERAGE_PATH || '.', name + ".json"),
        coverageStr);
}

export async function cursorToTop(editor: TextEditor){
    // this method appears to be a common source unreliable behavior so we do the commands
    // slowly
    (await editor.elem).click();
    await sleep(100);
    await browser.keys([Key.Ctrl, 'A']);
    await sleep(100);
    await browser.keys(Key.ArrowLeft);
    await sleep(100);
    browser.waitUntil(async () => {
        let coord = await editor.getCoordinates();
        coord[0] === 1 && coord[1] === 1;
    });
    await sleep(200);
}

export async function setupEditor(str: string){
    const workbench = await browser.getWorkbench();

    // clear any older notificatoins
    console.log("[DEBUG]: clearing notifications");
    let notifications = await workbench.getNotifications();
    for(let note of notifications){
        await note.dismiss();
    }

    console.log('[DEBUG]: creating new file');
    browser.keys([Key.Ctrl, 'n']);

    console.log('[DEBUG]: waiting for editor to be available');
    const editorView = await workbench.getEditorView();
    const title = await browser.waitUntil(async () => {
        let tab = await editorView.getActiveTab();
        const title = await tab?.getTitle();
        if(title && title.match(/Untitled/)){
            return title;
        }
        return;
    }, { interval: 1000, timeout: 10000 });
    const editor = await editorView.openEditor(title!) as TextEditor;

    // set the text
    // NOTE: setting editor text is somewhat flakey, so we verify that it worked
    console.log("[DEBUG]: setting text to: "+str.slice(0, 50)+"...");
    await browser.waitUntil(async () => {
        await editor.setText(str);
        await waitUntilCursorUnmoving(editor);
        let text = await editor.getText();
        return text === str;
    });

    // focus the editor
    console.log("[DEBUG]: Focusing editor");
    await cursorToTop(editor);

    // NOTE: I often see flaky tests at the very start of a spec. My first guess is we need
    // to give some time for the editor to finish loading stuff asynchronously from
    // `setupEditor` before it is responsive again.
    await sleep(1000);
    return editor;
}

export function prettifyPrefix(str: string){
    str = str.toUpperCase();
    str = str.replace(/shift(\+|$)/gi, '⇧');
    str = str.replace(/ctrl(\+|$)/gi, '^');
    str = str.replace(/alt(\+|$)/gi, '⌥');
    str = str.replace(/meta(\+|$)/gi, '◆');
    str = str.replace(/win(\+|$)/gi, '⊞');
    str = str.replace(/cmd(\+|$)/gi, '⌘');
    str = str.replace(/escape/gi, "ESC");
    return str;
}

// TODO: test out and get this function working
const MODAL_KEY_MAP: Record<string, string> = {
    'shift': Key.Shift,
    'alt': Key.Alt,
    'tab': Key.Tab,
    'cmd': Key.Command,
    'ctrl': Key.Control,
    'escape': Key.Escape,
    'space': Key.Space
};

// TODO: implement count
interface ModalKeySpec {
    key: string | string[]
    count?: number
    updatesStatus?: boolean
}
type ModalKey = string | string[] | ModalKeySpec;
function modalKeyToStringArray(key: ModalKey): string[] {
    let simpleKey: string | string[];
    if((key as ModalKeySpec).key){
        simpleKey = (key as ModalKeySpec).key;
    }else{
        simpleKey = (key as string | string[]);
    }
    if(Array.isArray(simpleKey)){
        return simpleKey;
    }else{
        return [simpleKey];
    }
};

function modalKeyCount(key: ModalKey){
    if((key as ModalKeySpec).key){
        return (key as ModalKeySpec).count;
    }else{
        return undefined;
    }
}

function modalKeyUpdateStatus(key: ModalKey){
    if((key as ModalKeySpec).key){
        let update = (key as ModalKeySpec).updatesStatus;
        if(update === undefined){
            return true;
        }else{
            return update;
        }
    }else{
        return true;
    }
}

export async function enterModalKeys(...keySeq: ModalKey[]){
    const workbench = await browser.getWorkbench();
    const statusBar = await (new StatusBar(workbench.locatorMap));
    let keySeqString = "";
    let cleared;


    let waitOpts = {interval: 50, timeout: 5000};
    cleared = await browser.waitUntil(() => statusBar.getItem('No Keys Typed'),
        { ...waitOpts,
            timeoutMsg: `Old keys didn't clear, while trying to press \n${JSON.stringify(keySeq, null, 4)}` } );
    expect(cleared).toBeTruthy();

    let count = 0;
    let checkCleared = true;
    for(const keys_ of keySeq){
        checkCleared = true;
        const keys = modalKeyToStringArray(keys_);
        if(!isEqual(keys.map(x => x.toLowerCase()), keys)){
            throw Error("Keys must all be lower case (use 'shift')");
        }
        const keyCodes = keys.map(k => MODAL_KEY_MAP[k] !== undefined ? MODAL_KEY_MAP[k] : k);
        const keyCount = modalKeyCount(keys_);
        if(keyCount === undefined){
            let keyString = keys.map(prettifyPrefix).join('');
            if(keySeqString){
                keySeqString += ", " + keyString;
            }else{
                keySeqString = keyString;
            }
        }else{
            count = count * 10 + keyCount;
        }
        let currentKeySeqString = (count ? count + "× " : '') + keySeqString;

        browser.keys(keyCodes);
        if(modalKeyUpdateStatus(keys_)){
            let registered = await browser.waitUntil(() =>
                statusBar.getItem('Keys Typed: '+currentKeySeqString),
                { ...waitOpts,
                    timeoutMsg: `UI didn't register typed key: \n${JSON.stringify(currentKeySeqString, null, 4)}` });
            expect(registered).toBeTruthy();
        }else{
            checkCleared = false;
        }
    }
    if(checkCleared){
        cleared = await browser.waitUntil(() => statusBar.getItem('No Keys Typed'),
            { ...waitOpts,
                timeoutMsg: `Final keys didn't clear while pressing \n${JSON.stringify(keySeq, null, 4)}` });
        expect(cleared).toBeTruthy();
    }

    return;
}

export async function waitForMode(mode: string, opts: Partial<WaitUntilOptions> = {}){
    const workbench = await browser.getWorkbench();
    const statusBar = await (new StatusBar(workbench.locatorMap));
    let modeSet = await browser.waitUntil(() =>
        statusBar.getItem('Keybinding Mode: '+mode),
        opts);
    expect(modeSet).toBeTruthy();
    return;
}

async function coordChange(editor: TextEditor, oldpos: {x: number, y: number}): Promise<{x: number, y: number}> {
    let newpos = await editor.getCoordinates();
    let ydiff = newpos[0] - oldpos.y;
    let xdiff = newpos[1] - oldpos.x;
    return {y: ydiff, x: xdiff};
}

export async function waitUntilCursorUnmoving(editor: TextEditor, oldpos?: {x: number, y: number}){
    if(!oldpos){
        let [y, x] = await editor.getCoordinates();
        oldpos = {x, y};
    }

    let lastMove = {x: 0, y: 0};
    let stepsUnchanged = 0;
    return await browser.waitUntil(async() => {
        let move = await coordChange(editor, oldpos);

        if(isEqual(lastMove, move)){ stepsUnchanged += 1; }
        else{
            lastMove = move;
            stepsUnchanged = 0;
        };
        if(stepsUnchanged > 1){
            return move;
        }
    }, {interval: 300, timeout: 9000});
}

export async function movesCursorInEditor(action: () => Promise<void>, by: [number, number], editor: TextEditor){
    let [y, x] = await editor.getCoordinates();
    let oldpos = {x, y};
    await action();
    let expected = {y: by[0], x: by[1]};
    let actual = await coordChange(editor, oldpos);
    // most of the time we can just run `expect` right away...
    if(isEqual(actual, expected)){
        expect(actual).toEqual(expected);
        return;
    }
    // but some commands require that we wait before their effects are observed...
    // in this case we need to have some confidence that no further moves are
    // going to happen
    let maybeActual = await waitUntilCursorUnmoving(editor, oldpos);
    expect(maybeActual).toEqual(expected);
}

export async function movesCursorTo(action: () => Promise<void>, by: [number, number], editor: TextEditor){
    await action();
    let newpos = await editor.getCoordinates();
    expect({y: newpos[0], x: newpos[1]}).toEqual({y: by[0], x: by[1]});
}
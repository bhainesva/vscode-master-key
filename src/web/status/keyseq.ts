import * as vscode from 'vscode';
import { onSet } from '../state';
import { PREFIX } from '../commands/prefix';
import { COUNT } from '../commands/count';
import { Map } from 'immutable';
import { prettifyPrefix } from '../utils';

let keyStatusBar: vscode.StatusBarItem | undefined = undefined;

const KEY_DISPLAY_DELAY_DEFAULT = process.env.TESTING ? 100 : 500;
let keyDisplayDelay: number = KEY_DISPLAY_DELAY_DEFAULT;
let statusUpdates = Number.MIN_SAFE_INTEGER;

function updateKeyStatus(values: Map<string, unknown>){
    if(keyStatusBar !== undefined && keyDisplayDelay > 0){
        let count = <number>values.get(COUNT, 0);
        let plannedUpdate = count ? count + "× " : '';
        plannedUpdate += prettifyPrefix(<string>values.get(PREFIX, ''));
        if(plannedUpdate.length > 0){
            keyStatusBar.text = plannedUpdate;
            keyStatusBar.accessibilityInformation = { label: 'Keys Typed: '+plannedUpdate };
        }else{
            // clearing the prefix is delayed so users can see the completed command
            let currentUpdate = statusUpdates;
            setTimeout(() => {
                if(currentUpdate === statusUpdates){
                    if(statusUpdates < Number.MAX_SAFE_INTEGER){
                        statusUpdates += 1;
                    }else{
                        statusUpdates = Number.MIN_SAFE_INTEGER;
                    }

                    if(keyStatusBar){
                        keyStatusBar.text = plannedUpdate;
                        keyStatusBar.accessibilityInformation = { label: 'No Keys Typed' };
                    }
                }
            }, keyDisplayDelay);
        }
    }
    return true;
}

function updateConfig(event?: vscode.ConfigurationChangeEvent){
    if((!event && !process.env.TESTING) || event?.affectsConfiguration('master-key')){
        let config = vscode.workspace.getConfiguration('master-key');
        keyDisplayDelay = config.get<number>('keyDisplayDelay') || KEY_DISPLAY_DELAY_DEFAULT;
    }
}

export async function activate(context: vscode.ExtensionContext){
    updateConfig();
    vscode.workspace.onDidChangeConfiguration(updateConfig);

    keyStatusBar = vscode.window.createStatusBarItem('keys', vscode.StatusBarAlignment.Left, -10000);
    keyStatusBar.accessibilityInformation = { label: "No Keys Typed" };
    keyStatusBar.show();
    await onSet(PREFIX, updateKeyStatus);
    await onSet(COUNT, updateKeyStatus);
}

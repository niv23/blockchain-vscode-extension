/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
*/
'use strict';

import * as vscode from 'vscode';
import { Reporter } from './util/Reporter';
import { BlockchainNetworkExplorerProvider } from './explorer/BlockchainNetworkExplorer';
import { BlockchainPackageExplorerProvider } from './explorer/BlockchainPackageExplorer';
import { addConnection } from './commands/addConnectionCommand';
import { deleteConnection } from './commands/deleteConnectionCommand';
import { addConnectionIdentity } from './commands/addConnectionIdentityCommand';
import { connect } from './commands/connectCommand';
import { createSmartContractProject } from './commands/createSmartContractProjectCommand';
import { packageSmartContract } from './commands/packageSmartContractCommand';

import { VSCodeOutputAdapter } from './logging/VSCodeOutputAdapter';
import { DependencyManager } from './dependencies/DependencyManager';
import { TemporaryCommandRegistry } from './dependencies/TemporaryCommandRegistry';
import { ExtensionUtil } from './util/ExtensionUtil';
import { FabricRuntimeManager } from './fabric/FabricRuntimeManager';
import { RuntimeTreeItem } from './explorer/model/RuntimeTreeItem';
import { startFabricRuntime } from './commands/startFabricRuntime';
import { stopFabricRuntime } from './commands/stopFabricRuntime';
import { restartFabricRuntime } from './commands/restartFabricRuntime';
import { toggleFabricRuntimeDevMode } from './commands/toggleFabricRuntimeDevMode';
import { FabricConnectionRegistryEntry } from './fabric/FabricConnectionRegistryEntry';
import { ConnectionTreeItem } from './explorer/model/ConnectionTreeItem';
import { BlockchainTreeItem } from './explorer/model/BlockchainTreeItem';
import { deleteSmartContractPackage } from './commands/deleteSmartContractPackageCommand';
import { PeerTreeItem } from './explorer/model/PeerTreeItem';
import { installSmartContract } from './commands/installCommand';
import { ChannelTreeItem } from './explorer/model/ChannelTreeItem';
import { instantiateSmartContract} from './commands/instantiateCommand';

let blockchainNetworkExplorerProvider: BlockchainNetworkExplorerProvider;
let blockchainPackageExplorerProvider: BlockchainPackageExplorerProvider;

export async function activate(context: vscode.ExtensionContext): Promise<void> {

    const packageJson: any = ExtensionUtil.getPackageJSON();

    if (packageJson.production !== true) {
        await Reporter.instance().dispose();
    }

    const outputAdapter: VSCodeOutputAdapter = VSCodeOutputAdapter.instance();
    outputAdapter.log('extension activating');

    try {
        const dependancyManager = DependencyManager.instance();
        if (!dependancyManager.hasNativeDependenciesInstalled()) {
            await dependancyManager.installNativeDependencies();

            registerCommands(context);

            const tempCommandRegistry: TemporaryCommandRegistry = TemporaryCommandRegistry.instance();
            await tempCommandRegistry.executeStoredCommands();
        } else {
            registerCommands(context);
        }

        await ensureLocalFabricExists();

        ExtensionUtil.setExtensionContext(context);
        outputAdapter.log('extension activated');
    } catch (error) {
        console.log(error);
        outputAdapter.error('Failed to activate extension see previous messages for reason');
        const result = await vscode.window.showErrorMessage('Failed to activate extension', 'open output view');
        if (result) {
            outputAdapter.show();
        }
    }
}

export async function deactivate(): Promise<void> {
    const context: vscode.ExtensionContext = ExtensionUtil.getExtensionContext();
    await Reporter.instance().dispose();
    disposeExtension(context);
}

/*
 * Should only be called outside this file in tests
 */
export function registerCommands(context: vscode.ExtensionContext): void {
    blockchainNetworkExplorerProvider = new BlockchainNetworkExplorerProvider();
    blockchainPackageExplorerProvider = new BlockchainPackageExplorerProvider();

    disposeExtension(context);

    context.subscriptions.push(vscode.window.registerTreeDataProvider('blockchainExplorer', blockchainNetworkExplorerProvider));
    context.subscriptions.push(vscode.window.registerTreeDataProvider('blockchainAPackageExplorer', blockchainPackageExplorerProvider));
    context.subscriptions.push(vscode.commands.registerCommand('blockchainExplorer.refreshEntry', (element: BlockchainTreeItem) => blockchainNetworkExplorerProvider.refresh(element)));
    context.subscriptions.push(vscode.commands.registerCommand('blockchainExplorer.connectEntry', (connection: FabricConnectionRegistryEntry, identityName) => connect(connection, identityName)));
    context.subscriptions.push(vscode.commands.registerCommand('blockchainExplorer.disconnectEntry', () => blockchainNetworkExplorerProvider.disconnect()));
    context.subscriptions.push(vscode.commands.registerCommand('blockchainExplorer.addConnectionEntry', addConnection));
    context.subscriptions.push(vscode.commands.registerCommand('blockchainExplorer.deleteConnectionEntry', (connection: ConnectionTreeItem) => deleteConnection(connection)));
    context.subscriptions.push(vscode.commands.registerCommand('blockchainExplorer.addConnectionIdentityEntry', (connection: ConnectionTreeItem) => addConnectionIdentity(connection)));
    context.subscriptions.push(vscode.commands.registerCommand('blockchain.createSmartContractProjectEntry', createSmartContractProject));
    context.subscriptions.push(vscode.commands.registerCommand('blockchainAPackageExplorer.packageSmartContractProjectEntry', packageSmartContract));
    context.subscriptions.push(vscode.commands.registerCommand('blockchainAPackageExplorer.refreshEntry', () => blockchainPackageExplorerProvider.refresh()));
    context.subscriptions.push(vscode.commands.registerCommand('blockchainExplorer.startFabricRuntime', (runtimeTreeItem?: RuntimeTreeItem) => startFabricRuntime(runtimeTreeItem)));
    context.subscriptions.push(vscode.commands.registerCommand('blockchainExplorer.stopFabricRuntime', (runtimeTreeItem?: RuntimeTreeItem) => stopFabricRuntime(runtimeTreeItem)));
    context.subscriptions.push(vscode.commands.registerCommand('blockchainExplorer.restartFabricRuntime', (runtimeTreeItem?: RuntimeTreeItem) => restartFabricRuntime(runtimeTreeItem)));
    context.subscriptions.push(vscode.commands.registerCommand('blockchainExplorer.toggleFabricRuntimeDevMode', (runtimeTreeItem?: RuntimeTreeItem) => toggleFabricRuntimeDevMode(runtimeTreeItem)));
    context.subscriptions.push(vscode.commands.registerCommand('blockchainAPackageExplorer.deleteSmartContractPackageEntry', (project) => deleteSmartContractPackage(project)));
    context.subscriptions.push(vscode.commands.registerCommand('blockchainExplorer.installSmartContractEntry', (peerTreeItem?: PeerTreeItem) => installSmartContract(peerTreeItem)));
    context.subscriptions.push(vscode.commands.registerCommand('blockchainExplorer.instantiateSmartContractEntry', (channelTreeItem?: ChannelTreeItem) => instantiateSmartContract(channelTreeItem)));

    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {

        if (e.affectsConfiguration('fabric.connections') || e.affectsConfiguration('fabric.runtimes')) {
            return vscode.commands.executeCommand('blockchainExplorer.refreshEntry');
        }
    }));

    const packageJson = ExtensionUtil.getPackageJSON();

    if (packageJson.production === true) {
        context.subscriptions.push(Reporter.instance());
    }

}

export async function ensureLocalFabricExists(): Promise<void> {
    const runtimeManager: FabricRuntimeManager = FabricRuntimeManager.instance();
    if (runtimeManager.exists('local_fabric')) {
        return;
    }
    await runtimeManager.add('local_fabric');
}

function disposeExtension(context: vscode.ExtensionContext): void {
    // remove old subscriptions
    context.subscriptions.forEach((item) => {
        if (item) {
            item.dispose();
        }
    });
    context.subscriptions.splice(0, context.subscriptions.length);
}

/*
 * Needed for testing
 */
export function getBlockchainNetworkExplorerProvider(): BlockchainNetworkExplorerProvider {
    return blockchainNetworkExplorerProvider;
}

export function getBlockchainPackageExplorerProvider(): BlockchainPackageExplorerProvider {
    return blockchainPackageExplorerProvider;
}

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
import { IBlockchainQuickPickItem, UserInputUtil } from './UserInputUtil';
import { PackageTreeItem } from '../explorer/model/PackageTreeItem';
import { PackageRegistry } from '../packages/PackageRegistry';
import { PackageRegistryEntry } from '../packages/PackageRegistryEntry';

export async function deleteSmartContractPackage(packageTreeItem: PackageTreeItem): Promise<{} | void> {
    console.log('deleteSmartContractPackage');
    let packagesToDelete: PackageRegistryEntry[];
    if (packageTreeItem) {
        packagesToDelete = [packageTreeItem.packageEntry];
    } else {
        const chosenPackages: IBlockchainQuickPickItem<PackageRegistryEntry>[] = await UserInputUtil.showSmartContractPackagesQuickPickBox('Choose the smart contract package(s) that you want to delete', true) as IBlockchainQuickPickItem<PackageRegistryEntry>[];
        if (!chosenPackages) {
            return;
        }

        packagesToDelete = chosenPackages.map((_package) => {
            return _package.data;
        });
    }

    const packageRegistry: PackageRegistry = PackageRegistry.instance();

    for (const _package of packagesToDelete) {
        await packageRegistry.delete(_package);
    }

    return vscode.commands.executeCommand('blockchainAPackageExplorer.refreshEntry');
}

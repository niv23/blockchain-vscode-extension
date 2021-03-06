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

import Dockerode = require('dockerode');
import * as path from 'path';
import * as fs from 'fs-extra';
import { FabricRuntimeRegistryEntry } from './FabricRuntimeRegistryEntry';
import { FabricRuntimeRegistry } from './FabricRuntimeRegistry';
import { OutputAdapter } from '../logging/OutputAdapter';
import { ConsoleOutputAdapter } from '../logging/ConsoleOutputAdapter';
import { CommandUtil } from '../util/CommandUtil';
import { EventEmitter } from 'events';

const basicNetworkPath = path.resolve(__dirname, '..', '..', '..', 'basic-network');
const basicNetworkConnectionProfilePath = path.resolve(basicNetworkPath, 'connection.json');
const basicNetworkConnectionProfile = JSON.parse(fs.readFileSync(basicNetworkConnectionProfilePath).toString());
const basicNetworkAdminPath = path.resolve(basicNetworkPath, 'crypto-config/peerOrganizations/org1.example.com/users/Admin@org1.example.com');
const basicNetworkAdminCertificatePath = path.resolve(basicNetworkAdminPath, 'msp/signcerts/Admin@org1.example.com-cert.pem');
const basicNetworkAdminCertificate = fs.readFileSync(basicNetworkAdminCertificatePath, 'utf8');
const basicNetworkAdminPrivateKeyPath = path.resolve(basicNetworkAdminPath, 'msp/keystore/cd96d5260ad4757551ed4a5a991e62130f8008a0bf996e4e4b84cd097a747fec_sk');
const basicNetworkAdminPrivateKey = fs.readFileSync(basicNetworkAdminPrivateKeyPath, 'utf8');

interface ContainerPorts {
    [portAndProtocol: string]: Array<{
      HostIp: string;
      HostPort: string;
    }>;
  }

export class FabricRuntime extends EventEmitter {

    private runtimeRegistry: FabricRuntimeRegistry = FabricRuntimeRegistry.instance();
    private docker: Dockerode;
    private name: string;
    private busy: boolean = false;

    constructor(private runtimeRegistryEntry: FabricRuntimeRegistryEntry) {
        super();
        this.name = runtimeRegistryEntry.name;
        this.docker = new Dockerode();
    }

    public getName(): string {
        return this.name;
    }

    public isBusy(): boolean {
        return this.busy;
    }

    public async start(outputAdapter?: OutputAdapter): Promise<void> {
        try {
            this.setBusy(true);
            await this.startInner(outputAdapter);
        } finally {
            this.setBusy(false);
        }
    }

    public async stop(outputAdapter?: OutputAdapter): Promise<void> {
        try {
            this.setBusy(true);
            await this.stopInner(outputAdapter);
        } finally {
            this.setBusy(false);
        }
    }

    public async restart(outputAdapter?: OutputAdapter): Promise<void> {
        try {
            this.setBusy(true);
            await this.stopInner(outputAdapter);
            await this.startInner(outputAdapter);
        } finally {
            this.setBusy(false);
        }
    }

    public async getConnectionProfile(): Promise<object> {
        const containerPrefix: string = this.getContainerPrefix();
        const connectionProfile: any = basicNetworkConnectionProfile;
        const peerPorts: ContainerPorts = await this.getContainerPorts(`${containerPrefix}_peer0.org1.example.com_1`);
        const peerRequestHost: string = this.fixHost(peerPorts['7051/tcp'][0].HostIp);
        const peerRequestPort: string = peerPorts['7051/tcp'][0].HostPort;
        const peerEventHost: string = this.fixHost(peerPorts['7053/tcp'][0].HostIp);
        const peerEventPort: string = peerPorts['7053/tcp'][0].HostPort;
        const ordererPorts: ContainerPorts = await this.getContainerPorts(`${containerPrefix}_orderer.example.com_1`);
        const ordererHost: string = this.fixHost(ordererPorts['7050/tcp'][0].HostIp);
        const ordererPort: string = ordererPorts['7050/tcp'][0].HostPort;
        const caPorts: ContainerPorts = await this.getContainerPorts(`${containerPrefix}_ca.example.com_1`);
        const caHost: string = this.fixHost(caPorts['7054/tcp'][0].HostIp);
        const caPort: string = caPorts['7054/tcp'][0].HostPort;
        connectionProfile.peers['peer0.org1.example.com'].url = `grpc://${peerRequestHost}:${peerRequestPort}`;
        connectionProfile.peers['peer0.org1.example.com'].eventUrl = `grpc://${peerEventHost}:${peerEventPort}`;
        connectionProfile.orderers['orderer.example.com'].url = `grpc://${ordererHost}:${ordererPort}`;
        connectionProfile.certificateAuthorities['ca.org1.example.com'].url = `http://${caHost}:${caPort}`;
        return connectionProfile;
    }

    public async getCertificate(): Promise<string> {
        return basicNetworkAdminCertificate;
    }

    public async getPrivateKey(): Promise<string> {
        return basicNetworkAdminPrivateKey;
    }

    public async isRunning(): Promise<boolean> {
        const containerPrefix: string = this.getContainerPrefix();
        const running: boolean[] = await Promise.all([
            this.isContainerRunning(`${containerPrefix}_peer0.org1.example.com_1`),
            this.isContainerRunning(`${containerPrefix}_orderer.example.com_1`),
            this.isContainerRunning(`${containerPrefix}_ca.example.com_1`)
        ]);
        return !running.some((value: boolean) => value === false);
    }

    public isDevelopmentMode(): boolean {
        return this.runtimeRegistryEntry.developmentMode;
    }

    public async setDevelopmentMode(developmentMode: boolean): Promise<void> {
        this.runtimeRegistryEntry.developmentMode = developmentMode;
        await this.runtimeRegistry.update(this.runtimeRegistryEntry);
    }

    private setBusy(busy: boolean) {
        this.busy = busy;
        this.emit('busy', busy);
    }

    private async startInner(outputAdapter?: OutputAdapter): Promise<void> {
        await this.execute('start', outputAdapter);
    }

    private async stopInner(outputAdapter?: OutputAdapter): Promise<void> {
        await this.execute('stop', outputAdapter);
        await this.execute('teardown', outputAdapter);
    }

    private async execute(script: string, outputAdapter?: OutputAdapter): Promise<void> {
        if (!outputAdapter) {
            outputAdapter = ConsoleOutputAdapter.instance();
        }

        const env: any = Object.assign({}, process.env, {
            COMPOSE_PROJECT_NAME: this.getContainerPrefix(),
            CORE_CHAINCODE_MODE: this.runtimeRegistryEntry.developmentMode ? 'dev' : 'net'
        });

        if (process.platform === 'win32') {
            await CommandUtil.sendCommandWithOutput('cmd', [ '/c', `${script}.cmd` ], basicNetworkPath, env, outputAdapter);
        } else {
            await CommandUtil.sendCommandWithOutput('/bin/sh', [ `${script}.sh` ], basicNetworkPath, env, outputAdapter);
        }
    }

    private async getContainerPorts(containerID: string): Promise<ContainerPorts> {
        const container: Dockerode.Container = this.docker.getContainer(containerID);
        const info: Dockerode.ContainerInspectInfo = await container.inspect();
        return info.NetworkSettings.Ports;
    }

    private async isContainerRunning(containerID: string): Promise<boolean> {
        try {
            const container: Dockerode.Container = this.docker.getContainer(containerID);
            const info: Dockerode.ContainerInspectInfo = await container.inspect();
            return info.State.Running;
        } catch (error) {
            return false;
        }
    }

    private getContainerPrefix(): string {
        // Docker on Linux only supports basic characters for the project name.
        const sanitizedName: string = this.name.replace(/[^A-Za-z0-9]/, '');
        return `fabricvscode${sanitizedName}`;
    }

    private fixHost(host: string): string {
        // Windows chokes on 0.0.0.0, so replace it with localhost.
        if (host === '0.0.0.0') {
            return 'localhost';
        }
        return host;
    }

}

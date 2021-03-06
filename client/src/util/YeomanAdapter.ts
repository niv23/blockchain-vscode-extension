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
import { UserInputUtil } from '../commands/UserInputUtil';
import { VSCodeOutputAdapter } from '../logging/VSCodeOutputAdapter';
import { CommandUtil } from '../util/CommandUtil';
import * as util from 'util';
const currentAnswers = {};

export class YeomanAdapter {

    public log: any;
    public aborted: boolean = false;

    constructor() {
        const logger = (...str) => {
            const msg = str.join('');
            VSCodeOutputAdapter.instance().log(msg);
        };
        this.log = logger;
        [
            'write',
            'writeln',
            'ok',
            'error',
            'skip',
            'force',
            'create',
            'invoke',
            'conflict',
            'identical',
            'info',
            'table'
          ].forEach(function(methodName) {
            this.log[methodName] = logger;
          }, this);
    }

    async prompt(prompts, cb): Promise<any> {
        const result: any = {};
        for (const prompt of prompts) {
            if (prompt.when && !prompt.when()) {
                continue;
            }

            const userOption: string = await UserInputUtil.showGeneratorOptions(prompt.message);
            let answer: string;

            switch (userOption) {
                case UserInputUtil.OVERWRITE_FILE:
                    answer = 'write';
                    break;
                case UserInputUtil.SKIP_FILE:
                    answer = 'skip';
                    break;
                case UserInputUtil.FORCE_FILES:
                    answer = 'force';
                    break;
                case UserInputUtil.ABORT_GENERATOR:
                    answer = 'abort';
                    break;
            }

            result[prompt.name] = answer;
        }

        if (cb) {
            try {
                cb(result);
            } catch (error) {
                // Ignore
            }
        }

        return result;
    }
}

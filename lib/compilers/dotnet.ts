// Copyright (c) 2021, Compiler Explorer Authors
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are met:
//
//     * Redistributions of source code must retain the above copyright notice,
//       this list of conditions and the following disclaimer.
//     * Redistributions in binary form must reproduce the above copyright
//       notice, this list of conditions and the following disclaimer in the
//       documentation and/or other materials provided with the distribution.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
// AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
// IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
// ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
// LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
// CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
// SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
// INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
// CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
// ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
// POSSIBILITY OF SUCH DAMAGE.

import path from 'path';

import fs from 'fs-extra';

/// <reference types="../base-compiler" />
import { DotNetAsmParser } from '../asm-parser-dotnet';
import { BaseCompiler } from '../base-compiler';

class DotNetCompiler extends BaseCompiler {
    private coreRoot: string;
    private crossgen2bin: string;
    private testAppSrc: string;
    private testAppName: string;

    protected asm: DotNetAsmParser;

    constructor(compilerInfo, env) {
        super(compilerInfo, env);

        this.coreRoot = this.compilerProps(`compiler.${this.compiler.id}.coreRoot`);
        this.testAppSrc = this.compilerProps(`compiler.${this.compiler.id}.testAppSrc`);
        this.testAppName = path.basename(this.testAppSrc);
        this.crossgen2bin = path.join(this.coreRoot, 'crossgen2', 'crossgen2.dll');
        this.asm = new DotNetAsmParser();
    }

    get compilerOptions() {
        return ['build', this.testAppName + '.csproj', '-c', 'Release', '-o', 'out', 
        // Enable unsafe code (raw pointers, etc)
        '/p:AllowUnsafeBlocks=true',
        // Disable nullability, we don't want to see its attributes in the output
        '/p:Nullable=disable',
        // Speed up compilation:
        '--no-dependencies', '-v', 'q'];
    }

    get configurableOptions() {
        return ['--targetos', '--targetarch', '--instruction-set', '--singlemethodtypename', '--singlemethodname',
                '--singlemethodindex', '--singlemethodgenericarg', '--codegenopt', '--codegen-options'];
    }

    get configurableSwitches() {
        return ['-O', '--optimize', '--Od', '--optimize-disabled', '--Os', '--optimize-space', '--Ot', 
                '--optimize-time'];
    }

    async runCompiler(compiler, options, inputFileName, execOptions) {
        if (!execOptions) {
            execOptions = this.getDefaultExecOptions();
        }

        const programDir = path.dirname(inputFileName);
        const sourceFile = path.basename(inputFileName);

        await fs.copy(this.testAppSrc, programDir);
        
        execOptions.env.DOTNET_TC_QuickJitForLoops = 'true';
        execOptions.env.DOTNET_CLI_TELEMETRY_OPTOUT = 'true';
        execOptions.env.DOTNET_SKIP_FIRST_TIME_EXPERIENCE = 'true';
        execOptions.env.DOTNET_NOLOGO='true';
        execOptions.customCwd = programDir;

        let crossgen2Options = [];
        const configurableOptions = this.configurableOptions;

        for (const configurableOption of configurableOptions) {
            const optionIndex = options.indexOf(configurableOption);
            if (optionIndex === -1 || optionIndex === options.length - 1) {
                continue;
            }
            crossgen2Options = crossgen2Options.concat([options[optionIndex], options[optionIndex + 1]]);
        }

        const configurableSwitches = this.configurableSwitches;
        for (const configurableSwitch of configurableSwitches) {
            const switchIndex = options.indexOf(configurableSwitch);
            if (switchIndex === -1) {
                continue;
            }
            crossgen2Options.push(options[switchIndex]);
        }

        const compilerResult = await super.runCompiler(compiler, this.compilerOptions, inputFileName, execOptions);
        if (compilerResult.code !== 0) {
            return compilerResult;
        }

        const crossgen2Result = await this.runCrossgen2(
            compiler,
            execOptions,
            this.crossgen2bin,
            this.coreRoot,
            path.join('out', this.testAppName + '.dll'),
            crossgen2Options,
            this.getOutputFilename(programDir, this.outputFilebase),
        );

        if (crossgen2Result.code !== 0) {
            return crossgen2Result;
        }

        return compilerResult;
    }

    optionsForFilter() {
        return this.compilerOptions;
    }

    async runCrossgen2(compiler, execOptions, crossgen2Path, references, dllPath, options, outputPath) {
        const crossgen2Options = [
            crossgen2Path, '-r', path.join(references, '*.dll'), dllPath, '-o', 'CompilerExplorer.r2r.dll',
            '--codegenopt', 'NgenDisasm=*', '--codegenopt', 'JitDiffableDasm=1', '--parallelism', '1',
            '--inputbubble', '--compilebubblegenerics',
        ].concat(options);

        const result = await this.exec(compiler, crossgen2Options, execOptions);
        result.inputFilename = dllPath;
        const transformedInput = result.filenameTransform(dllPath);
        this.parseCompilationOutput(result, transformedInput);

        await fs.writeFile(
            outputPath,
            result.stdout.map(o => o.text).reduce((a, n) => `${a}\n${n}`),
        );

        return result;
    }
}

export class CSharpCompiler extends DotNetCompiler {
    static get key() { return 'csharp'; }
}

export class FSharpCompiler extends DotNetCompiler {
    static get key() { return 'fsharp'; }
}

export class VBCompiler extends DotNetCompiler {
    static get key() { return 'vb'; }
}

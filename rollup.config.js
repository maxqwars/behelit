import typescript from '@rollup/plugin-typescript';
import { obfuscator } from 'rollup-obfuscator';
import { config } from 'dotenv';
import { env, cwd } from 'node:process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import terser from '@rollup/plugin-terser';

config();

/* Define path`s */
const packageJsonPath = join(cwd(), 'package.json');

/* Prepare external modules list (loaded from node_modules) */
const sourcePkg = readFileSync(packageJsonPath);
const pkg = JSON.parse(sourcePkg);
const nodeModules = Object.keys(pkg.dependencies);

/* Export rollup configuration */
export default [
  {
    input: 'src/finder.ts',
    output: {
      dir: 'release',
      format: 'es',
    },
    plugins: [typescript()],
    external: [...nodeModules],
  },
];

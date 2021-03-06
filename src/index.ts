import * as ts from 'typescript';
import { createFilter } from 'rollup-pluginutils';
import { statSync } from 'fs';
import assign from 'object-assign';

// This is loaded verbatim.
import helpersTemplate from './typescript-helpers.ts';

import { endsWith } from './string';
import fixExportClass from './fixExportClass';

const jsxOptions = {
	'preserve': ts.JsxEmit.Preserve,
	'react': ts.JsxEmit.React
}

const resolveHost = {
	fileExists ( filePath: string ): boolean {
		try {
			return statSync( filePath ).isFile();
		} catch ( err ) {
			return false;
		}
	}
};

function goodErrors ( diagnostic: ts.Diagnostic ): boolean {
	// All errors except `Cannot compile modules into 'es6' when targeting 'ES5' or lower.`
	return diagnostic.code !== 1204;
}

export default function typescript ( options ) {
	options = assign( {}, options || {} );

	const filter = createFilter(
		options.include || [ '*.ts+(|x)', '**/*.ts+(|x)' ],
		options.exclude || [ '*.d.ts', '**/*.d.ts' ] );

	delete options.include;
	delete options.exclude;

	// Allow users to override the TypeScript version used for transpilation.
	const typescript: typeof ts = options.typescript || ts;

	if ( typeof options.jsx === 'string' ) {
		options.jsx = jsxOptions[ options.jsx ] || ts.JsxEmit.None;
	}

	options = assign( {
		noEmitHelpers: true,
		target: ts.ScriptTarget.ES5,
		module: ts.ModuleKind.ES6,
		sourceMap: true
	}, options );

	return {
		load ( id ) {
			if ( id === 'typescript-helpers' ) {
				return helpersTemplate;
			}
		},

		resolveId ( importee: string, importer: string ): string {
			// Handle the special `typescript-helpers` import itself.
			if ( importee === 'typescript-helpers' ) return 'typescript-helpers';

			if ( !importer ) return null;

			var result = typescript.nodeModuleNameResolver( importee, importer, resolveHost );

			if ( result.resolvedModule && result.resolvedModule.resolvedFileName ) {
				if ( endsWith( result.resolvedModule.resolvedFileName, '.d.ts' ) ) {
					return null;
				}

				return result.resolvedModule.resolvedFileName;
			}

			return null;
		},

		transform ( code: string, id: string ): { code: string, map: any } {
			if ( !filter( id ) ) return null;

			const transformed = typescript.transpileModule( fixExportClass( code, id ), {
				fileName: id,
				reportDiagnostics: true,
				compilerOptions: options
			});

			const diagnostics = transformed.diagnostics.filter( goodErrors );
			let fatalError = false;

			diagnostics.forEach( diagnostic => {
				var message = typescript.flattenDiagnosticMessageText(diagnostic.messageText, '\n');

				if ( diagnostic.file ) {
					const { line, character } = diagnostic.file.getLineAndCharacterOfPosition( diagnostic.start );

					console.error( `${diagnostic.file.fileName}(${line + 1},${character + 1}): error TS${diagnostic.code}: ${message}` );
				} else {
					console.error( `Error: ${message}` );
				}

				if ( diagnostic.category === ts.DiagnosticCategory.Error ) {
					fatalError = true;
				}
			});

			if ( fatalError ) {
				throw new Error( `There were TypeScript errors transpiling "${id}"` );
			}

			return {
				// Always append an import for the helpers.
				code: transformed.outputText +
					`\nimport { __extends, __decorate, __metadata, __param, __awaiter } from 'typescript-helpers';`,

				// Rollup expects `map` to be an object so we must parse the string
				map: JSON.parse(transformed.sourceMapText)
			};
		}
	};
}

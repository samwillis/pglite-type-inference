import { promises as fs } from "fs";
import * as ts from "typescript";
import { glob } from "glob";
import { PGlite, DescribeQueryResult, types } from "@electric-sql/pglite";
import chokidar from 'chokidar';
import debounce from 'lodash/debounce';

// Define an interface to store query method call information
interface QueryCall {
  sql: string;
  args: string[];
}

interface FileQueryCalls {
  filePath: string;
  queryCalls: QueryCall[];
}

// Helper function to recursively traverse AST nodes
function findQueryCalls(
  node: ts.Node,
  queryCalls: QueryCall[],
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker
): void {
  if (ts.isCallExpression(node)) {
    const expression = node.expression;

    // Check if the method is a 'query' call on an instance of PGlite
    if (
      ts.isPropertyAccessExpression(expression) &&
      ts.isIdentifier(expression.expression) &&
      expression.name.escapedText === "query"
    ) {
      const args = node.arguments.map((arg) => arg.getText(sourceFile));
      let sql: string | undefined;

      if (ts.isStringLiteral(node.arguments[0])) {
        sql = node.arguments[0].text;
      } else if (ts.isNoSubstitutionTemplateLiteral(node.arguments[0])) {
        sql = node.arguments[0].text;
      } else if (ts.isTemplateExpression(node.arguments[0])) {
        sql = node.arguments[0].getText(sourceFile);
      } else if (ts.isIdentifier(node.arguments[0])) {
        // Try to resolve the value of the variable
        const symbol = checker.getSymbolAtLocation(node.arguments[0]);
        if (symbol && symbol.valueDeclaration) {
          const declaration = symbol.valueDeclaration;
          if (
            ts.isVariableDeclaration(declaration) &&
            declaration.initializer
          ) {
            if (ts.isStringLiteral(declaration.initializer)) {
              sql = declaration.initializer.text;
            } else if (
              ts.isNoSubstitutionTemplateLiteral(declaration.initializer)
            ) {
              sql = declaration.initializer.text;
            } else if (ts.isTemplateExpression(declaration.initializer)) {
              sql = declaration.initializer.getText(sourceFile);
            }
          }
        }
      }

      if (sql !== undefined) {
        queryCalls.push({ sql, args });
      } else {
        console.log(
          "Unable to resolve SQL for query call",
          node.getText(sourceFile)
        );
      }
    }
  }

  // Recursively search child nodes
  ts.forEachChild(node, (childNode) =>
    findQueryCalls(childNode, queryCalls, sourceFile, checker)
  );
}

// Process a single file asynchronously
async function processFile(filePath: string): Promise<QueryCall[]> {
  const sourceCode = await fs.readFile(filePath, "utf8");
  const program = ts.createProgram([filePath], {});
  const sourceFile = program.getSourceFile(filePath);
  const checker = program.getTypeChecker();

  if (!sourceFile) {
    throw new Error(`Could not find source file: ${filePath}`);
  }

  const queryCalls: QueryCall[] = [];

  // Search for query method calls in the AST
  findQueryCalls(sourceFile, queryCalls, sourceFile, checker);

  return queryCalls;
}

// Recursively find all TypeScript files in the directory using a promise-based glob
function getAllTSFiles(dirPath: string): Promise<string[]> {
  return glob(`${dirPath}/**/*.{ts,tsx}`);
}

// Main function to scan codebase for query method calls
async function findPGliteQueryCalls(
  rootDir: string
): Promise<FileQueryCalls[]> {
  const tsFiles = await getAllTSFiles(rootDir);
  const allQueryCalls: FileQueryCalls[] = [];

  for (const filePath of tsFiles) {
    const queryCalls = await processFile(filePath);
    if (queryCalls.length > 0) {
      allQueryCalls.push({ filePath, queryCalls });
    }
  }

  return allQueryCalls;
}

async function getMigrationsSql(
  migrationsDir = "./migrations"
): Promise<string[]> {
  const migrationFiles = await glob(`${migrationsDir}/**/*.sql`);
  migrationFiles.sort();
  const migrations = await Promise.all(
    migrationFiles.map(async (file) => {
      const sql = await fs.readFile(file, "utf8");
      return sql;
    })
  );
  return migrations;
}

async function getQueryDescriptions(
  db: PGlite,
  queryCalls: FileQueryCalls[]
): Promise<QueryDescription> {
  const descriptions: QueryDescription = {};
  for (const file of queryCalls) {
    for (const queryCall of file.queryCalls) {
      const sql = queryCall.sql;
      const ret = await db.describeQuery(sql);
      descriptions[sql] = ret;
    }
  }
  return descriptions;
}

type QueryDescription = Record<string, DescribeQueryResult>;

interface QueryTypes {
  paramTypes: string[];
  returnTypes: { column: string; type: string }[];
}

// Postgres OID types to TypeScript types
const OidToTypeScriptType = {
  [types.BOOL]: "boolean",
  [types.BYTEA]: "Uint8Array",
  [types.CHAR]: "string",
  [types.INT8]: "bigint",
  [types.INT2]: "number",
  [types.INT4]: "number",
  [types.REGPROC]: "number",
  [types.TEXT]: "string",
  [types.OID]: "number",
  [types.TID]: "number",
  [types.XID]: "number",
  [types.CID]: "number",
  [types.JSON]: "any",
  [types.XML]: "string",
  [types.PG_NODE_TREE]: "string",
  [types.SMGR]: "number",
  [types.PATH]: "string",
  [types.POLYGON]: "string",
  [types.CIDR]: "string",
  [types.FLOAT4]: "number",
  [types.FLOAT8]: "number",
  [types.ABSTIME]: "number",
  [types.RELTIME]: "number",
  [types.TINTERVAL]: "string",
  [types.CIRCLE]: "string",
  [types.MACADDR8]: "string",
  [types.MONEY]: "string",
  [types.MACADDR]: "string",
  [types.INET]: "string",
  [types.ACLITEM]: "string",
  [types.BPCHAR]: "string",
  [types.VARCHAR]: "string",
  [types.DATE]: "Date",
  [types.TIME]: "string",
  [types.TIMESTAMP]: "Date",
  [types.TIMESTAMPTZ]: "Date",
  [types.INTERVAL]: "string",
  [types.TIMETZ]: "string",
  [types.BIT]: "string",
  [types.VARBIT]: "string",
  [types.NUMERIC]: "string",
  [types.REFCURSOR]: "string",
  [types.REGPROCEDURE]: "number",
  [types.REGOPER]: "number",
  [types.REGOPERATOR]: "number",
  [types.REGCLASS]: "number",
  [types.REGTYPE]: "number",
  [types.UUID]: "string",
  [types.TXID_SNAPSHOT]: "string",
  [types.PG_LSN]: "string",
  [types.PG_NDISTINCT]: "string",
  [types.PG_DEPENDENCIES]: "string",
  [types.TSVECTOR]: "string",
  [types.TSQUERY]: "string",
  [types.GTSVECTOR]: "string",
  [types.REGCONFIG]: "number",
  [types.REGDICTIONARY]: "number",
  [types.JSONB]: "any",
  [types.REGNAMESPACE]: "number",
  [types.REGROLE]: "number",
};

function template(types: string[], params: string, result: string) {
  return `import { PGliteInterface, QueryOptions, Results } from "@electric-sql/pglite";
${types.join("\n")}

type Params<Q> = ${params};

type Result<Q, T> = ${result};

type Simplify<T> = T extends object ? { [K in keyof T]: T[K] } : T;

export type PGliteWithTypes = {
  query<T = unknown, Q extends string = string>(
    query: Q,
    params?: Params<Q>,
    options?: QueryOptions
  ): Promise<Results<Simplify<Result<Q, T>>>>;
} & Omit<PGliteInterface, "query">;
`;
}

async function gen() {
  const rootDir = "./src";
  const migrationsDir = "./migrations";
  const migrations = await getMigrationsSql(migrationsDir);

  console.log("Creating database...");
  const db = await PGlite.create();

  console.log("Applying migrations...");
  for (const migration of migrations) {
    await db.exec(migration);
  }

  console.log("Finding query calls...");
  const queryCalls = await findPGliteQueryCalls(rootDir);

  console.log("Generating types...");
  const descriptions = await getQueryDescriptions(db, queryCalls);

  const types = Object.entries(descriptions).map(([sql, description], i) => {
    const paramTypes = description.queryParams.map(
      (param) => OidToTypeScriptType[param.dataTypeID]
    );
    const returnTypes = description.resultFields.map(
      (param) => `${param.name}: ${OidToTypeScriptType[param.dataTypeID]}`
    );
    return `
type Q${i} = \`${sql}\`;
type Q${i}Params = [ ${paramTypes.join(", ")} ]${
      paramTypes.length ? "" : " | undefined"
    };
type Q${i}Result = { ${returnTypes.join(", ")} };`;
  });

  const params = Object.entries(descriptions).map(([sql, description], i) => {
    return `Q extends Q${i} ? Q${i}Params : `;
  }).join("") + "any[]";

  const result = Object.entries(descriptions).map(([sql, description], i) => {
    return `Q extends Q${i} ? Q${i}Result : `;
  }).join("") + "T";

  const output = template(types, params, result);

  await fs.writeFile("./src/pglite-types.gen.ts", output);
}

async function main() {
  const args = process.argv.slice(2);
  const watchMode = args.includes('--watch');

  if (watchMode) {
    console.log('Running in watch mode. Press Ctrl+C to exit.');
    
    const debouncedGen = debounce(async () => {
      console.log('Regenerating types...');
      try {
        await gen();
        console.log('Types regenerated successfully.');
      } catch (error) {
        console.error('Error regenerating types:', error);
      }
    }, 10);

    const watcher = chokidar.watch(['src', 'migrations'], {
      ignored: [
        /(^|[\/\\])\../, // ignore dotfiles
        "src/pglite-types.gen.ts",
      ],
      persistent: true,
      ignoreInitial: false,
      usePolling: true,
      interval: 1000,
      binaryInterval: 1000,
    });

    console.log('Watcher initialized. Waiting for changes...');

    watcher
      .on('all', (event, path) => {
        console.log(`Event: ${event}, Path: ${path}`);
        if (path.endsWith('.ts') || path.endsWith('.tsx') || path.endsWith('.sql')) {
          console.log(`Relevant file changed. Queueing type regeneration...`);
          debouncedGen();
        }
      })
      .on('error', error => console.error(`Watcher error: ${error}`));

    // Trigger initial generation
    await gen();
    console.log('Initial type generation complete.');
  } else {
    await gen();
  }
}

main();

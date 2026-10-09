// `import x from "./file.dll" with { type: "file" }` → path string (embedded by bun build --compile).
declare module "*.dll" { const path: string; export default path; }
declare module "*.so" { const path: string; export default path; }

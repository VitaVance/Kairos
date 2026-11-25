/**
 * Ambient declaration so `import './x.css'` type-checks in every package.
 * Vite handles the actual bundling; TypeScript only needs to know the import
 * is side-effect-only and valid.
 */
declare module '*.css' {
  const content: string;
  export default content;
}

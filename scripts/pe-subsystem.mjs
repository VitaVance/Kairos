#!/usr/bin/env node
/**
 * Read the PE subsystem field from a Windows executable.
 *
 * Why this exists: `#![windows_subsystem = "windows"]` is a linker directive,
 * not a runtime property. If it sits in the wrong crate root (a `lib.rs`
 * instead of `main.rs`), the code compiles, the tests pass, and the app still
 * opens with a terminal window attached — and closing that terminal kills the
 * process via CTRL_CLOSE_EVENT. Nothing in the source tells you which one you
 * got; only the PE header does:
 *
 *   2 = IMAGE_SUBSYSTEM_WINDOWS_GUI      (no console)
 *   3 = IMAGE_SUBSYSTEM_WINDOWS_CUI      (console attached)
 *
 * This script was written after shipping exactly that bug.
 *
 * Usage:
 *   node scripts/pe-subsystem.mjs "D:\Program Files\清单\todolist.exe"
 *   pnpm exec node scripts/pe-subsystem.mjs apps/desktop/src-tauri/target/release/todolist.exe
 *
 * Exits non-zero when the file is not a PE image or is not a GUI binary, so it
 * can be used as a post-build gate.
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const SUBSYSTEM = {
  0: 'UNKNOWN',
  1: 'NATIVE',
  2: 'WINDOWS_GUI',
  3: 'WINDOWS_CUI',
  5: 'OS2_CUI',
  7: 'POSIX_CUI',
  9: 'WINDOWS_CE_GUI',
  10: 'EFI_APPLICATION',
};

const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/pe-subsystem.mjs <path-to-exe>');
  process.exit(2);
}

let buf;
try {
  buf = readFileSync(path);
} catch (error) {
  console.error(`✗ cannot read ${path}: ${error.message}`);
  process.exit(2);
}

// Minimum viable PE: DOS header (0x40) + e_lfanew + PE signature + one optional
// header. Anything shorter is not an executable.
if (buf.length < 0x100) {
  console.error(`✗ ${path} is too small to be a PE image (${buf.length} bytes)`);
  process.exit(1);
}

if (buf[0] !== 0x4d || buf[1] !== 0x5a) {
  // 'MZ'
  console.error(`✗ ${path} has no MZ signature — not a PE image`);
  process.exit(1);
}

const peOffset = buf.readUInt32LE(0x3c);
if (buf.toString('latin1', peOffset, peOffset + 4) !== 'PE\0\0') {
  console.error(`✗ ${path} has no PE signature at 0x${peOffset.toString(16)}`);
  process.exit(1);
}

// Optional header starts right after the 20-byte COFF header + 4-byte PE sig.
const optionalHeader = peOffset + 4 + 20;
const magic = buf.readUInt16LE(optionalHeader);
if (magic !== 0x10b && magic !== 0x20b) {
  console.error(`✗ ${path} has an unrecognised optional-header magic 0x${magic.toString(16)}`);
  process.exit(1);
}

// The subsystem sits at the same offset (0x44) in both PE32 and PE32+.
const subsystem = buf.readUInt16LE(optionalHeader + 0x44);

console.log(`${basename(path)}`);
console.log(`  format     ${magic === 0x20b ? 'PE32+' : 'PE32'}`);
console.log(`  subsystem  ${subsystem} (${SUBSYSTEM[subsystem] ?? 'unknown'})`);

if (subsystem === 3) {
  console.error('✗ CONSOLE subsystem — this build will open a terminal window.');
  console.error('  Check that #![windows_subsystem = "windows"] is in main.rs.');
  process.exit(1);
}
if (subsystem !== 2) {
  console.error(`✗ expected subsystem 2 (GUI), got ${subsystem}`);
  process.exit(1);
}

console.log('✓ GUI subsystem — no console window');

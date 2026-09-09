#!/usr/bin/env bun

import { main } from "../src/main.ts";

try {
  await main(process.argv.slice(2));
} catch (error) {
  const errors = error instanceof AggregateError ? error.errors : [error];
  for (const item of errors) {
    console.error(item instanceof Error ? item.message : String(item));
  }
  process.exitCode = 1;
}

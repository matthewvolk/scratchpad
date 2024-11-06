#!/usr/bin/env node

import { program } from "@commander-js/extra-typings";

import { catalog } from "./commands/catalog.js";

program.name("cli").addCommand(catalog);

program.parse(process.argv);

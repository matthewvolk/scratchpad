#!/usr/bin/env node

import { program } from "@commander-js/extra-typings";

import { catalog } from "./commands/catalog.js";

program.name("scratchpad").addCommand(catalog);

program.parse(process.argv);

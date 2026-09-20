#!/usr/bin/env node
import { runStdio } from "./stdio.ts";
import { BelServer } from "./server.ts";

runStdio(new BelServer());

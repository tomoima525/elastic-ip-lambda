#!/usr/bin/env node
import * as dotenv from "dotenv"; // see https://github.com/motdotla/dotenv#how-do-i-use-dotenv-with-import
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { MigrationStack } from "../lib/nat-migration-stack";

dotenv.config();
const account = process.env.CDK_ACCOUNT;
const region = process.env.CDK_REGION;
const app = new cdk.App();
new MigrationStack(app, `Migration`, {
  env: {
    account,
    region,
  },
});

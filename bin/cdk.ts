#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { InfraCdkStack } from "../lib/infra-cdk-stack";
import { HasuraCdkStack } from "../lib/hasura-cdk-stack";

export type TargetEnvironment = 'dev' | 'prod'

const app = new cdk.App();

const env = (app.node.tryGetContext("CDK_ENV") as TargetEnvironment) ?? "dev";

const projectId = (app.node.tryGetContext("PROJECT_ID") as TargetEnvironment) ?? "hasura"

const infraCdk = new InfraCdkStack(app, `${projectId}-${env}-InfraCdkStack`, {
  tags: {
    environment: env,
    projectId,
  },
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-1',
  }
});

new HasuraCdkStack(app, `${projectId}-${env}-HasuraCdkStack`, {
  tags: {
    environment: env,
    projectId
  },
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-1',
  },
  fargateGroup: infraCdk.fargateGroup,
  vpc: infraCdk.vpc,
});

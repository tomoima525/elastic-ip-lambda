import {
  aws_ec2 as ec2,
  aws_lambda_nodejs as lambda_nodejs,
  aws_lambda as lambda,
  aws_secretsmanager as secretManager,
  aws_rds as rds,
  aws_ssm as ssm,
  Stack,
  StackProps,
  CfnOutput,
  RemovalPolicy,
  Aspects,
} from "aws-cdk-lib";

import { Construct } from "constructs";
import * as path from "path";
import * as fs from "fs";

export class MigrationStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // --- Retrieve VPC ---
    // vpc id
    const vpcId = ssm.StringParameter.valueFromLookup(this, "vpc-id");
    const vpc = ec2.Vpc.fromLookup(this, "vpc-id", {
      vpcId: vpcId,
    });

    // --- Retrieve Security Group ---
    const publicSgId = ssm.StringParameter.valueFromLookup(
      this,
      "publicSg-sgId",
    );

    const publicSg = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      "public-sg",
      publicSgId,
    );

    console.log("publicSgId: ", publicSgId);

    // ---- migration step 1. Create custom nat in the same VPC ----
    const customNat = new ec2.Instance(this, `nat-instance`, {
      vpc,
      securityGroup: publicSg,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO,
      ),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      keyName: "testkeypair2", // replace with your own keypair
      sourceDestCheck: false, // should be false for NAT instances
      associatePublicIpAddress: true, // assigns public IPs to this instance
    });

    // Inject intial script to setup iptable routing for NAT
    const initScriptPath = path.join(`${__dirname}/`, "init-script.sh");
    const userData = fs.readFileSync(initScriptPath, "utf8");
    customNat.addUserData(userData);

    new CfnOutput(this, "NatInstanceID", {
      value: customNat.instanceId,
    });
    new ssm.StringParameter(this, "NAT-instance-id", {
      parameterName: "nat-instance-id",
      stringValue: customNat.instanceId,
    });
  }
}

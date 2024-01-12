import {
  aws_ec2 as ec2,
  aws_lambda_nodejs as lambda_nodejs,
  aws_lambda as lambda,
  Stack,
  StackProps,
  CfnOutput,
  RemovalPolicy,
} from "aws-cdk-lib";

import { Construct } from "constructs";
import * as path from "path";
import * as fs from "fs";
import { CfnRouteTable, Subnet } from "aws-cdk-lib/aws-ec2";

export class DevelopmentTemplateStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Pattern 1 - NAT Gateway from AMI
    const natIntance = ec2.NatProvider.instance({
      machineImage: new ec2.GenericLinuxImage({
        // NAT instance AMI
        // Use this if you do not want to manually setup routing on the NAT instance
        "us-west-2": "ami-0fffeee9375de306f",
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO,
      ),
    });
    // VPC with 2 NAT instances, with public and private subnets
    const vpc = new ec2.Vpc(this, "VPC", {
      ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"),
      natGateways: 2,
      natGatewayProvider: natIntance,
      maxAzs: 2,
      subnetConfiguration: [
        {
          name: "private-",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 28,
        },
        {
          name: "public-",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 28,
        },
      ],
    });

    // Setup Elastic IPs for the NAT instances
    const natInstance1 = vpc.node
      .findChild("public-Subnet1")
      .node.findChild("NatInstance") as ec2.Instance;
    const natInstance2 = vpc.node
      .findChild("public-Subnet2")
      .node.findChild("NatInstance") as ec2.Instance;
    const elasticIp1 = new ec2.CfnEIP(this, "ElasticIp1");
    new ec2.CfnEIPAssociation(this, "EipAssociation1", {
      eip: elasticIp1.ref,
      instanceId: natInstance1.instanceId,
    });
    const elasticIp2 = new ec2.CfnEIP(this, "ElasticIp2");
    new ec2.CfnEIPAssociation(this, "EipAssociation2", {
      eip: elasticIp2.ref,
      instanceId: natInstance2.instanceId,
    });

    new lambda_nodejs.NodejsFunction(this, "CurrentIP", {
      runtime: lambda.Runtime.NODEJS_18_X,
      vpc,
      handler: "handler",
      entry: path.join(`${__dirname}/../`, "functions", "current-ip/index.ts"),
      bundling: {
        format: lambda_nodejs.OutputFormat.ESM,
      },
    });

    new CfnOutput(this, "VPCID", {
      value: vpc.vpcId,
    });
  }
}

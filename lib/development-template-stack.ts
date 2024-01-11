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

    // Pattern 2 - Your own NAT instance
    const vpc2 = new ec2.Vpc(this, "VPC2", {
      ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"),
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
    // Security group -- allow ssh
    const publicSg = new ec2.SecurityGroup(this, "public-sg", {
      vpc: vpc2,
      allowAllOutbound: true,
    });

    publicSg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(22),
      "allow ssh access",
    );

    const customNat = new ec2.Instance(this, `custom-nat-instance`, {
      vpc: vpc2,
      securityGroup: publicSg,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO,
      ),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      keyName: "testkeypair2", // replace with your own keypair
      sourceDestCheck: false, // should be false for NAT instances
      associatePublicIpAddress: true, // assigns public IPs to Subnets
    });

    // Inject intial script to setup iptable routing for NAT
    const initScriptPath = path.join(`${__dirname}/`, "init-script.sh");
    const userData = fs.readFileSync(initScriptPath, "utf8");
    customNat.addUserData(userData);

    customNat.applyRemovalPolicy(RemovalPolicy.DESTROY);

    new lambda_nodejs.NodejsFunction(this, "CurrentIP", {
      runtime: lambda.Runtime.NODEJS_18_X,
      vpc,
      handler: "handler",
      entry: path.join(`${__dirname}/../`, "functions", "current-ip/index.ts"),
      bundling: {
        format: lambda_nodejs.OutputFormat.ESM,
      },
    });
    new lambda_nodejs.NodejsFunction(this, "CurrentIP2", {
      runtime: lambda.Runtime.NODEJS_18_X,
      vpc: vpc2,
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

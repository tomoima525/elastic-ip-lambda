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

export class NatInstanceStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Pattern 2 - Your own NAT instance
    const vpc = new ec2.Vpc(this, "VPC", {
      ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"),
      maxAzs: 2,
      natGateways: 0, // We don't use NAT Gateways
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
      vpc,
      allowAllOutbound: true,
    });

    publicSg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(22),
      "allow ssh access",
    );
    publicSg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      "allow http access",
    );

    publicSg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      "allow https access",
    );

    const customNat = new ec2.Instance(this, `custom-nat-instance`, {
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
      associatePublicIpAddress: true, // assigns public IPs to Subnets
    });

    // Inject intial script to setup iptable routing for NAT
    const initScriptPath = path.join(`${__dirname}/`, "init-script.sh");
    const userData = fs.readFileSync(initScriptPath, "utf8");
    customNat.addUserData(userData);

    // Route all traffic from private subnets to NAT instance. Since AZ is 2, we have 2 private subnets
    const privateSubnets = vpc.selectSubnets({
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
    }).subnets as ec2.Subnet[];
    privateSubnets[0].addRoute(`NAT-route-0`, {
      routerId: customNat.instanceId,
      routerType: ec2.RouterType.INSTANCE,
      destinationCidrBlock: "0.0.0.0/0",
    });
    privateSubnets[1].addRoute(`NAT-route-1`, {
      routerId: customNat.instanceId,
      routerType: ec2.RouterType.INSTANCE,
      destinationCidrBlock: "0.0.0.0/0",
    });

    // Assign elastic IPs to NAT instances
    const elasticIp = new ec2.CfnEIP(this, "ElasticIp");
    new ec2.CfnEIPAssociation(this, "EipAssociation", {
      eip: elasticIp.ref,
      instanceId: customNat.instanceId,
    });

    customNat.applyRemovalPolicy(RemovalPolicy.DESTROY);

    new lambda_nodejs.NodejsFunction(this, "CheckCurrentIP", {
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

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

export class VpcRDSStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, "migration-VPC", {
      ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"),
      maxAzs: 2,
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

    // We need this security group to allow our proxy to query our Postgre Instance
    const dbConnectionGroup = new ec2.SecurityGroup(
      this,
      "Proxy to DB Connection",
      {
        vpc,
      },
    );
    dbConnectionGroup.addIngressRule(
      dbConnectionGroup,
      ec2.Port.tcp(5432),
      "allow db connection",
    );
    dbConnectionGroup.addIngressRule(
      publicSg,
      ec2.Port.tcp(5432),
      "allow lambda connection",
    );

    // Dynamically generate the username and password, then store in secrets manager
    const databaseCredentialsSecret = new secretManager.Secret(
      this,
      "DBCredentialsSecret",
      {
        secretName: id + "-rds-credentials",
        generateSecretString: {
          secretStringTemplate: JSON.stringify({
            username: "tomo",
          }),
          excludePunctuation: true,
          includeSpace: false,
          generateStringKey: "password",
        },
        removalPolicy: RemovalPolicy.DESTROY,
      },
    );

    const rdsInstance = new rds.DatabaseCluster(this, "DBCluster", {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_13_7,
      }),
      removalPolicy: RemovalPolicy.DESTROY,
      instances: 1,
      instanceProps: {
        vpc,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        instanceType: new ec2.InstanceType("serverless"),
        autoMinorVersionUpgrade: true,
        securityGroups: [dbConnectionGroup],
      },
      credentials: rds.Credentials.fromSecret(databaseCredentialsSecret),
      port: 5432,
      defaultDatabaseName: "mydb",
    });

    // add capacity to the db cluster to enable scaling
    Aspects.of(rdsInstance).add({
      visit(node) {
        if (node instanceof rds.CfnDBCluster) {
          node.serverlessV2ScalingConfiguration = {
            minCapacity: 0.5, // min capacity is 0.5 vCPU
            maxCapacity: 1, // max capacity is 1 vCPU (default)
          };
        }
      },
    });

    const jumpBox = new ec2.Instance(this, "jump-box", {
      vpc,
      securityGroup: publicSg,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T2,
        ec2.InstanceSize.MICRO,
      ),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      keyName: "testkeypair2", // replace with your own keypair
    });

    // ---- A function to check the current Public IP address ----

    new lambda_nodejs.NodejsFunction(this, "CheckCurrentIP", {
      runtime: lambda.Runtime.NODEJS_18_X,
      vpc,
      securityGroups: [publicSg],
      handler: "handler",
      entry: path.join(`${__dirname}/../`, "functions", "current-ip/index.ts"),
      bundling: {
        format: lambda_nodejs.OutputFormat.ESM,
      },
    });

    new CfnOutput(this, "VPCID", {
      value: vpc.vpcId,
    });

    // use from other stacks
    new ssm.StringParameter(this, "VPC-ID", {
      parameterName: "vpc-id",
      stringValue: vpc.vpcId,
    });
    new ssm.StringParameter(this, "publicSg-sgId", {
      parameterName: "publicSg-sgId",
      stringValue: publicSg.securityGroupId as string,
    });
  }
}

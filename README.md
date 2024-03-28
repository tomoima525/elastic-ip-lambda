# Static IP for Lamdba function, using NAT instance

- This sample project demonstrates how to set up Elastic IP for a Lambda function using a NAT instance.
- The Lambda function has a static IP address, the Elastic IP of the NAT instance.
  <p align="left">
    <img width="1121" alt="log" src="https://github.com/tomoima525/elastic-ip-lambda/assets/6277118/b876c200-8b38-43c9-a8f6-f857651490d3">
    <img width="1240" alt="elastic IP" src="https://github.com/tomoima525/elastic-ip-lambda/assets/6277118/62d3641d-c684-464d-a3d1-69ac7d9624b4">
  </p>

## Why static IP?

- Some services require a static IP to allow access. For example, Stripe requires an IP allowlist to access restricted data. You can allow the IP of a Lambda function to access those services.

## Why NAT instance?

While you can set up static IP for a Lambda function using a NAT Gateway, it is expensive. NAT instance is much cheaper when you don't have to worry about the scalability of the NAT instance.

## Architecture

- NAT instance exists in multiple AZs, with a route table that routes all traffic to the internet gateway.
- NAT instances are in a public subnet, with an Elastic IP attached.
- Lambda function is in a private subnet, with a route table that routes all traffic to the NAT instance.
<p align="center">
  <img width="512" alt="architecture" src="https://github.com/tomoima525/elastic-ip-lambda/assets/6277118/8e280245-81a6-472e-8ecb-054b125fb4c8">
</p>

## Implementations

There are 2 patterns to implement this architecture. I implemented both patterns, but recommended to use Pattern2.

### Pattern1: Use AWS official AMI(deprecated)

AWS provides an AMI that is specifically for NAT. However it reached the end of maintenance support on December 31, 2023.

- With this pattern we have to manually set Elastic IP. We access NAT instance by accessing the child node of VPC

```
// Use escape hatch to attach EIP
const natInstance1 = vpc.node
  .findChild("public-Subnet1")
  .node.findChild("NatInstance") as ec2.Instance;
```

- Ref: https://docs.aws.amazon.com/cdk/v2/guide/cfn_layer.html

### Pattern2. Create your own AMI

- In the CDK, I used Amazon Linux 2023, which has `ens5` as a primary network interface. This may differ depending on the AMI you use. You can check the primary network interface by running `netstat -i` command on the instance. We use this interface to set up NAT.

```
netstat -i
Kernel Interface table
Iface             MTU    RX-OK RX-ERR RX-DRP RX-OVR    TX-OK TX-ERR TX-DRP TX-OVR Flg
ens5             9001    19194      0      0 0          2275      0      0      0 BMRU
lo              65536       12      0      0 0            12      0      0      0 LRU
```

- The AMI should be deployed under the following settings:

  - Source/Dest. check is disabled
  - Exists in public subnet of VPC created
  - Set Keypair for SSH access
  - Set Security Group for SSH access (Accept port 22)

- We use `addUserData` function to run the following commands when the instance is created.

```
//init-script.sh
# install iptable
sudo yum install iptables-services -y
sudo systemctl enable iptables
sudo systemctl start iptables

# Turning on IP Forwarding
echo "net.ipv4.ip_forward = 1" | sudo tee -a /etc/sysctl.conf
sudo sysctl -p

# Making a catchall rule for routing and masking the private IP
# Amazon Linux 2023 primay network interface is ens5
sudo iptables -t nat -A POSTROUTING -o ens5 -s 0.0.0.0/0 -j MASQUERADE
sudo /sbin/iptables -F FORWARD
sudo service iptables save
```

- Inside CDK, this script is set up as follows:

```
const initScriptPath = path.join(`${__dirname}/`, "init-script.sh");
const userData = fs.readFileSync(initScriptPath, "utf8");
customNat.addUserData(userData);
```

- Route all traffic from private subnets to NAT instance. Since AZ is 2, we have 2 private subnets

```
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
```

- Set up Elastic IP for NAT instance

```
const elasticIp = new ec2.CfnEIP(this, "ElasticIp");
new ec2.CfnEIPAssociation(this, "EipAssociation", {
  eip: elasticIp.ref,
  instanceId: customNat.instanceId,
});
```

## Migrating existing NAT Gateway to NAT instance

- If you have an existing NAT Gateway, you can migrate to NAT instance with some manual steps.

Let's say you have VPC that has RDS and Lambda function. For public access, you have a NAT Gateway in the public subnet. Below is the CDK code to set up such environment.

```
pnpm cdk deploy --app 'npx ts-node bin/simple-nat.ts'
```

Now let's migrate to NAT instance.

### Step 1. Create custom nat in the same VPC

```
pnpm cdk deploy --app 'npx ts-node bin/nat-migration.ts'
```

### Step 2: Remove NAT Gateway manually from console

- We can not remove NAT Gatwway from CDK due to the bug related to VPC update
  - https://github.com/aws/aws-cdk/issues/6683
- Go to NAT gateway in VPC console to delete the NAT Gateway
  ![image](https://github.com/tomoima525/elastic-ip-lambda/assets/6277118/651d7ea7-3327-4024-bc04-1626de917fe4)
  ![image](https://github.com/tomoima525/elastic-ip-lambda/assets/6277118/36ab1645-54eb-49d5-b19a-3e0eb7b28a4a)
  ![image](https://github.com/tomoima525/elastic-ip-lambda/assets/6277118/1897f1da-4590-4bfb-8b36-70224cdec7d4)

### Step 3: Route all traffic from private subnets to NAT instance
- `0.0.0.0/0` routing to NAT Gateway in Private Subnet will cause conflicts when we route all traffic from Private subnets to NAT instance route
- You can do so from AWS console. Since AZ is 2, we have 2 private subnets
- Head to `VPC` and select `Resource map` tab
  ![image](https://github.com/tomoima525/elastic-ip-lambda/assets/6277118/20f10bff-dc31-4072-a48a-ff6dab534d46)

- Select Private Subnet from Route tables in Resource map
  ![image](https://github.com/tomoima525/elastic-ip-lambda/assets/6277118/f0cb16f0-88fe-462a-a551-1ba9499c9412)
- Remove NAT Gateway routes and remove
  ![image](https://github.com/tomoima525/elastic-ip-lambda/assets/6277118/2dddc600-af19-46aa-81ba-be87fac4f024)
- Add NAT instance instead
  ![image](https://github.com/tomoima525/elastic-ip-lambda/assets/6277118/5239c734-2c36-4d2f-8606-57173ff68975)


## References

- https://docs.aws.amazon.com/vpc/latest/userguide/VPC_NAT_Instance.html
- https://medium.com/nerd-for-tech/how-to-turn-an-amazon-linux-2023-ec2-into-a-nat-instance-4568dad1778f

## How to deploy

- Update `.env` file with your AWS account ID.

```
CDK_ACCOUNT=xxxxxxxxxxxx
CDK_REGION=us-west-2
```

```
pnpm i
pnpm cdk deploy:ami // for using existing AMI (Pattern1)
pnpm cdk deploy:custom // for using custom AMI (Pattern2)
```

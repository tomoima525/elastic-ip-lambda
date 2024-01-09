# Static IP for Lamdba function, using NAT instance

- This is a sample project to demonstrate how to setup Elastic IP for a Lambda function, using a NAT instance.

## Why static IP?

- Some services require a static IP to allow access. For example, Stripe requires a IP allowlist to access restricted data. You can allowlist the IP of a Lambda function to access those services.

## Why NAT instance?

While you can setup static IP for a Lambda function using a NAT Gateway, it is expensive. NAT instance is much cheaper when you don't have to worry about the scalability of the NAT instance.

## Architecture

- NAT instance exists in multiple AZs, with a route table that routes all traffic to the internet gateway.
- NAT instances are in a public subnet, with a Elastic IP attached to them.
- Lambda function is in a private subnet, with a route table that routes all traffic to the NAT instance.

- You can see that the Lambda function has a static IP address, which is the Elastic IP of the NAT instance.

## Tricks

These are the tricks that I used to make this work.

### 1. Use AMI for NAT

- We use AMI that is specifically for NAT

- If you want, you can select your own AMI, but you need to make sure that the AMI is deployed under the following settings:
  - Source/Dest. check is disabled
  - Exists in public subnet of VPC created
  - Set Keypair for SSH access
  - Set Security Group for SSH access
  - Configure the route tables of the private subnets to point to the NAT instance
- Then configure below after SSH into the NAT instance

```
echo "net.ipv4.ip_forward = 1" | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
sudo iptables -t nat -A POSTROUTING -o ens5 -s 0.0.0.0/0 -j MASQUERADE
```

Ref: https://medium.com/nerd-for-tech/how-to-turn-an-amazon-linux-2023-ec2-into-a-nat-instance-4568dad1778f

### 2. Use escape hatch to attach EIP

- We access NAT instance by accessing the child node of VPC

```
const natInstance1 = vpc.node
  .findChild("public-Subnet1")
  .node.findChild("NatInstance") as ec2.Instance;
```

-
- Ref: https://docs.aws.amazon.com/cdk/v2/guide/cfn_layer.html

## How to deploy

- Update `.env` file with your AWS account ID.

```
CDK_ACCOUNT=xxxxxxxxxxxx
CDK_REGION=us-west-2
```

```
pnpm i
pnpm cdk deploy
```

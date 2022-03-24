import { Stack, StackProps, Tags, RemovalPolicy } from "aws-cdk-lib";
import { Construct } from "constructs";
import {
  BastionHostLinux,
  Port,
  InterfaceVpcEndpoint,
  InterfaceVpcEndpointAwsService,
  InstanceClass,
  InstanceType,
  InstanceSize,
  SecurityGroup,
  SubnetType,
  Vpc,
  Peer,
} from "aws-cdk-lib/aws-ec2";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import {
  Credentials,
  DatabaseInstance,
  DatabaseInstanceEngine,
  DatabaseProxy,
  PostgresEngineVersion,
  ServerlessCluster,
} from "aws-cdk-lib/aws-rds";

export class InfraCdkStack extends Stack {
  public readonly env: string;
  public readonly projectId: string;
  public readonly vpc: Vpc;
  public readonly lambdaToRDSProxyGroup: SecurityGroup;
  public readonly fargateGroup: SecurityGroup;
  public readonly proxy: DatabaseProxy;
  public readonly databaseCredentialsSecret: Secret;
  public readonly databaseSlsCredentialsSecret: Secret;
  public readonly rdsServerlessCluster: ServerlessCluster;
  public readonly dbConnectionGroup: SecurityGroup;
  public readonly secret: {
    dbname: string;
    password: string;
    port: number;
    host: string;
    username: string;
  };

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, { ...props, subnetGroupName: undefined } as StackProps);

    this.env =
      props.tags && props.tags.environment ? props.tags.environment : "dev";

    this.projectId =
      props.tags && props.tags.projectId ? props.tags.projectId : "hasura";

    // VPC
    this.vpc = new Vpc(this, `${id}-VPC`, {
      cidr: "192.168.0.0/16",
      natGateways: 2,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: `${this.projectId}-${this.env}-public-subnet`,
          subnetType: SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: `${this.projectId}-${this.env}-private-subnet`,
          subnetType: SubnetType.PRIVATE_WITH_NAT,
        },
      ],
    });

    Tags.of(this.vpc).add("project", `${this.projectId}`);

    const bastionGroup = new SecurityGroup(
      this,
      `${this.projectId}-${this.env}-bastion-to-db-connection`,
      {
        vpc: this.vpc,
      }
    );

    this.lambdaToRDSProxyGroup = new SecurityGroup(
      this,
      `${this.projectId}-${this.env}-lambda-to-rds-proxy-connection`,
      {
        vpc: this.vpc,
      }
    );

    this.dbConnectionGroup = new SecurityGroup(
      this,
      `${this.projectId}-${this.env}-proxy-to-DB-connection`,
      {
        allowAllOutbound: true,
        vpc: this.vpc,
      }
    );

    this.fargateGroup = new SecurityGroup(
      this,
      `${this.projectId}-${this.env}-fargate-to-db-connection`,
      {
        vpc: this.vpc,
      }
    );

    this.dbConnectionGroup.addIngressRule(
      this.dbConnectionGroup,
      Port.tcp(5432),
      `${this.projectId}-${this.env}-allow-db-connection`
    );

    this.dbConnectionGroup.addIngressRule(
      Peer.ipv4(this.vpc.vpcCidrBlock),
      Port.tcp(5432),
      `${this.projectId}-${this.env}-postgresql`
    );

    this.dbConnectionGroup.addIngressRule(
      this.lambdaToRDSProxyGroup,
      Port.tcp(5432),
      `${this.projectId}-${this.env}-allow-lambda-connection`
    );

    this.dbConnectionGroup.addIngressRule(
      bastionGroup,
      Port.tcp(5432),
      `${this.projectId}-${this.env}-allow-bastion-connection`
    );

    this.dbConnectionGroup.addIngressRule(
      this.fargateGroup,
      Port.tcp(5432),
      `${this.projectId}-${this.env}-allow-fargate-connection}`
    );

    const host = new BastionHostLinux(
      this,
      `${this.projectId}-${this.env}-bastion-host`,
      {
        vpc: this.vpc,
        instanceName: `${this.projectId}-${this.env}-bastion-host`,
        instanceType: InstanceType.of(InstanceClass.T2, InstanceSize.MICRO),
        securityGroup: bastionGroup,
        subnetSelection: {
          subnetType: SubnetType.PUBLIC,
        },
      }
    );

    host.instance.addUserData("yum -y update", "yum install -y postgresql jq");

    this.databaseCredentialsSecret = new Secret(
      this,
      `${this.projectId}-${this.env}-db-credentials-secret`,
      {
        secretName: `${this.projectId}-${this.env}-rds-credentials`,
        generateSecretString: {
          secretStringTemplate: JSON.stringify({
            username: "syscdk",
          }),
          excludePunctuation: true,
          includeSpace: false,
          generateStringKey: "password",
        },
      }
    );

    this.databaseSlsCredentialsSecret = new Secret(
      this,
      `${this.projectId}-${this.env}-db-sls-credentials-secret`,
      {
        secretName: `${this.projectId}-${this.env}-rds-sls`,
        generateSecretString: {
          secretStringTemplate: JSON.stringify({
            username: "syscdk",
          }),
          excludePunctuation: true,
          includeSpace: false,
          generateStringKey: "password",
        },
      }
    );

    this.databaseCredentialsSecret.grantRead(host);

    new InterfaceVpcEndpoint(
      this,
      `${this.projectId}-${this.env}-secret-manager-vpc-endpoint`,
      {
        vpc: this.vpc,
        service: InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
      }
    );

    const rdsInstance: DatabaseInstance = new DatabaseInstance(
      this,
      `${this.projectId}-${this.env}-rds`,
      {
        instanceIdentifier: `${this.projectId}-${this.env}`,
        vpc: this.vpc,
        vpcSubnets: this.vpc.selectSubnets({
          subnetType: SubnetType.PRIVATE,
        }),
        autoMinorVersionUpgrade: false,
        databaseName: `${this.projectId}_${this.env}`,
        securityGroups: [this.dbConnectionGroup],
        engine: DatabaseInstanceEngine.postgres({
          version: PostgresEngineVersion.VER_12,
        }),
        credentials: Credentials.fromSecret(this.databaseCredentialsSecret),
        instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.MICRO),
        removalPolicy: RemovalPolicy.RETAIN,
      }
    );

    this.proxy = rdsInstance.addProxy(`${this.projectId}-${this.env}-proxy`, {
      dbProxyName: `${this.projectId}-${this.env}-proxy`,
      secrets: [this.databaseCredentialsSecret],
      debugLogging: true,
      vpc: this.vpc,
      securityGroups: [this.dbConnectionGroup],
    });
  }
}

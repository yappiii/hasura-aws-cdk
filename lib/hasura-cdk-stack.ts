import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import {
  ContainerDefinition,
  AwsLogDriver,
  ContainerImage,
  Secret as EcsSecret,
  TaskDefinition,
  Compatibility,
  Cluster,
  Ec2Service,
} from "aws-cdk-lib/aws-ecs";
import { Secret, ISecret } from "aws-cdk-lib/aws-secretsmanager";
import type { IVpc } from "aws-cdk-lib/aws-ec2";
import { DnsValidatedCertificate } from "aws-cdk-lib/aws-certificatemanager";
import { InstanceType, SecurityGroup } from "aws-cdk-lib/aws-ec2";
import { HostedZone, ARecord, RecordTarget } from "aws-cdk-lib/aws-route53";
import { LoadBalancerTarget } from "aws-cdk-lib/aws-route53-targets";
import {
  ApplicationLoadBalancer,
  ListenerAction,
  Protocol,
} from "aws-cdk-lib/aws-elasticloadbalancingv2";

interface Props extends StackProps {
  vpc: IVpc;
  fargateGroup: SecurityGroup;
}

export class HasuraCdkStack extends Stack {
  public readonly env: string;
  public readonly projectId: string;
  public readonly jwtSecret: ISecret;
  public readonly adminSecret: Secret;
  public readonly taskDefinition: TaskDefinition;
  public readonly containerDefinition: ContainerDefinition;
  public readonly cluster: Cluster;
  public readonly fargate: Ec2Service;
  public readonly loadBalancer: ApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, { ...props, subnetGroupName: undefined } as StackProps);

    this.env =
      props.tags && props.tags.environment ? props.tags.environment : "dev";

    this.projectId =
      props.tags && props.tags.projectId ? props.tags.projectId : "hasura";

    this.jwtSecret = Secret.fromSecretAttributes(
      this,
      `${this.projectId}-${this.env}-jwt-secret`,
      {
        secretCompleteArn: `${scope.node.tryGetContext("JWT_SECRET_ARN")}`,
      }
    );

    this.adminSecret = new Secret(
      this,
      `${this.projectId}-${this.env}-admin-secret`,
      {
        generateSecretString: {
          includeSpace: false,
          passwordLength: 32,
          excludePunctuation: true,
        },
      }
    );

    const rdsSecretForHasura = Secret.fromSecretAttributes(
      this,
      `${this.projectId}-${this.env}-rds-for-hasura-secret`,
      {
        secretCompleteArn: `${scope.node.tryGetContext(
          "RDS_FOR_HASURA_SECRET_ARN"
        )}`,
      }
    );

    this.taskDefinition = new TaskDefinition(
      this,
      `${this.projectId}-${this.env}-task-definition`,
      {
        compatibility: Compatibility.EC2,
      }
    );

    this.containerDefinition = new ContainerDefinition(
      this,
      `${id}-container-definition`,
      {
        logging: new AwsLogDriver({
          streamPrefix: "ecs",
        }),
        image: ContainerImage.fromRegistry(
          `hasura/graphql-engine:latest.amd64`
        ),
        secrets: {
          HASURA_GRAPHQL_ADMIN_SECRET: EcsSecret.fromSecretsManager(
            this.adminSecret
          ),
          PG_DATABASE_URL: EcsSecret.fromSecretsManager(rdsSecretForHasura),
          HASURA_GRAPHQL_JWT_SECRET: EcsSecret.fromSecretsManager(
            this.jwtSecret
          ),
          HASURA_GRAPHQL_METADATA_DATABASE_URL:
            EcsSecret.fromSecretsManager(rdsSecretForHasura),
        },
        environment: {
          HASURA_GRAPHQL_ENABLE_CONSOLE: "true",
          HASURA_GRAPHQL_DEV_MODE: "true",
          HASURA_GRAPHQL_ENABLED_LOG_TYPES:
            "startup, http-log, webhook-log, websocket-log, query-log",
        },
        entryPoint: ["graphql-engine"],
        command: [`serve`, "--enable-console"],
        taskDefinition: this.taskDefinition,
        memoryReservationMiB: 512,
      }
    );

    this.containerDefinition.addPortMappings({
      containerPort: 8080,
      hostPort: 8080,
    });

    this.cluster = new Cluster(
      this,
      `${this.projectId}-${this.env}-ecs-cluster`,
      {
        vpc: props.vpc,
      }
    );

    this.cluster.addCapacity(`${this.projectId}-${this.env}-cluster-capacity`, {
      instanceType: new InstanceType("t2.micro"),
      minCapacity: 0,
      desiredCapacity: 1,
      maxCapacity: 1,
    });

    this.fargate = new Ec2Service(
      this,
      `${this.projectId}-${this.env}-fargate-service`,
      {
        taskDefinition: this.taskDefinition,
        cluster: this.cluster,
      }
    );

    this.loadBalancer = new ApplicationLoadBalancer(this, `${id}-lb`, {
      vpc: props.vpc,
      internetFacing: true,
    });

    const zone = HostedZone.fromLookup(
      this,
      `${this.projectId}-${this.env}-zone`,
      { domainName: `${scope.node.tryGetContext("DOMAIN_NAME")}` }
    );

    const domainName = `${scope.node.tryGetContext(
      "SUBDOMAIN_NAME"
    )}.${scope.node.tryGetContext("DOMAIN_NAME")}`;

    const certificate = new DnsValidatedCertificate(
      this,
      `${this.projectId}-${this.env}-certificate`,
      {
        domainName,
        hostedZone: zone,
      }
    );

    const listener = this.loadBalancer.addListener(
      `${this.projectId}-${this.env}-lb-listener`,
      {
        port: 80,
        open: true,
      }
    );

    listener.addAction(`${this.projectId}-${this.env}-redirect`, {
      action: ListenerAction.redirect({
        protocol: Protocol.HTTPS,
        permanent: true,
        port: `443`,
        host: `#{host}`,
        path: `/#{path}`,
        query: `#{query}`,
      }),
    });

    const listener2 = this.loadBalancer.addListener(
      `${this.projectId}-${this.env}-lb-listener2`,
      {
        port: 443,
        open: true,
        certificates: [{ certificateArn: certificate.certificateArn }],
      }
    );

    listener2.addTargets(`${this.projectId}-${this.env}-ecs2`, {
      port: 8080,
      healthCheck: { path: `/healthz` },
      targets: [this.fargate],
    });

    new ARecord(this, `${this.projectId}-${this.env}-alias-record`, {
      recordName: domainName,
      target: RecordTarget.fromAlias(new LoadBalancerTarget(this.loadBalancer)),
      zone,
    });
  }
}

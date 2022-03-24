# hasura-aws-cdk

## Requirements

Node 14.5.0
CDK 2.15.0 (build 151055e)

## OverView

1. AWS Profileの設定

```
[default]
aws_access_key_id = XXXXXXXXXX
aws_secret_access_key = XXXXXXXXXX
```

2. パッケージのインストール

```shell
npm install
```

3. cdk bootstrap

4. インフラ基盤のデプロイ

```shell
cdk deploy infra-cdk-stack
```

5. 手動で RDS_FOR_HASURA_SECRET_ARN と JWT_SECRET_ARN を設定

- Hasura用のRDSエンドポイント

AWS Secret Managerで、Hasura用のpostgresqlのエンドポイントを以下のように設定します。

```
postgres://${username}:${password}@${rdsEndpoint}:5432/${databaseName}
```

作成したAWS Secret ManagerのArnを RDS_FOR_HASURA_SECRET_ARN に設定してください。

- JWT Secret

https://hasura.io/jwt-config/ で必要な情報を入力しJWT Configを取得してください。
AWS Secret Manager を作成し、 JWT Configを入力後、Arn を JWT_SECRET_ARN に設定してください。

6. Hasura用のドメインの取得

ドメイン取得後、DOMAIN_NAMEおよびSUBDOMAIN_NAMEを設定してください。

7. Hasuraのデプロイ

```shell
cdk deploy hasura-cdk-stack
```

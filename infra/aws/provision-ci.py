import copy
import json
from botocore.exceptions import ClientError
ACCOUNT='821656895501'
REGION='ap-south-1'
async def api(service,operation,params):
    return await call_boto3(service_name=service,operation_name=operation,region_name=REGION,params=params)
assert (await api('sts','GetCallerIdentity',{}))['Account']==ACCOUNT
tags=[{'Key':'Project','Value':'file-shelter'},{'Key':'Environment','Value':'demo'},{'Key':'ManagedBy','Value':'codex-mcp'}]
providers=(await api('iam','ListOpenIDConnectProviders',{}))['OpenIDConnectProviderList']
matching=[p['Arn'] for p in providers if p['Arn'].endswith('/token.actions.githubusercontent.com')]
provider=matching[0] if matching else (await api('iam','CreateOpenIDConnectProvider',{'Url':'https://token.actions.githubusercontent.com','ClientIDList':['sts.amazonaws.com'],'Tags':tags}))['OpenIDConnectProviderArn']
old_subject='repo:saaahilhussain/virtual-file-system:ref:refs/heads/main'
new_subject='repo:saaahilhussain@140058338/file-shelter@1123718025:ref:refs/heads/main'
trust={'Version':'2012-10-17','Statement':[{'Effect':'Allow','Principal':{'Federated':provider},'Action':'sts:AssumeRoleWithWebIdentity','Condition':{'StringEquals':{'token.actions.githubusercontent.com:aud':'sts.amazonaws.com','token.actions.githubusercontent.com:sub':new_subject}}}]}
frontend_bucket=f'arn:aws:s3:::file-shelter-frontend-{ACCOUNT}-mumbai'
frontend={'Version':'2012-10-17','Statement':[{'Effect':'Allow','Action':['s3:ListBucket','s3:GetBucketLocation'],'Resource':frontend_bucket},{'Effect':'Allow','Action':['s3:GetObject','s3:PutObject','s3:DeleteObject'],'Resource':frontend_bucket+'/*'},{'Effect':'Allow','Action':['cloudfront:CreateInvalidation','cloudfront:GetInvalidation'],'Resource':f'arn:aws:cloudfront::{ACCOUNT}:distribution/E1GKIK1Q7BCJ3R'}]}
backend={'Version':'2012-10-17','Statement':[{'Effect':'Allow','Action':'s3:PutObject','Resource':f'arn:aws:s3:::file-shelter-artifacts-{ACCOUNT}-mumbai/releases/*'},{'Effect':'Allow','Action':'ssm:SendCommand','Resource':[f'arn:aws:ec2:{REGION}:{ACCOUNT}:instance/i-0fd3ead0d7e6eaecf',f'arn:aws:ssm:{REGION}::document/AWS-RunShellScript']},{'Effect':'Allow','Action':'ssm:GetCommandInvocation','Resource':'*'}]}
created={}
for name, policy in [('FileShelterDemoFrontendDeployRole',frontend),('FileShelterDemoBackendDeployRole',backend)]:
    validation=await api('accessanalyzer','ValidatePolicy',{'policyDocument':json.dumps(policy),'policyType':'IDENTITY_POLICY'})
    errors=[f for f in validation['findings'] if f['findingType']=='ERROR']
    assert not errors, json.dumps(errors)
    try:
        role=(await api('iam','GetRole',{'RoleName':name}))['Role']
        assert {'Key':'Project','Value':'file-shelter'} in role.get('Tags',[]), 'Unrelated preexisting role'
        current_trust=role['AssumeRolePolicyDocument']
        updated_trust=copy.deepcopy(current_trust)
        matches=[]
        for statement in updated_trust.get('Statement',[]):
            action=statement.get('Action',[])
            actions=[action] if isinstance(action,str) else action
            conditions=statement.get('Condition',{}).get('StringEquals',{})
            if statement.get('Principal',{}).get('Federated')==provider and 'sts:AssumeRoleWithWebIdentity' in actions and conditions.get('token.actions.githubusercontent.com:aud')=='sts.amazonaws.com':
                matches.append(statement)
        if len(matches)!=1:
            raise RuntimeError(f'{name} has an unexpected GitHub OIDC trust policy')
        current_subject=matches[0]['Condition']['StringEquals'].get('token.actions.githubusercontent.com:sub')
        if current_subject not in (old_subject,new_subject):
            raise RuntimeError(f'{name} has an unexpected GitHub OIDC subject')
        if current_subject!=new_subject:
            matches[0]['Condition']['StringEquals']['token.actions.githubusercontent.com:sub']=new_subject
            await api('iam','UpdateAssumeRolePolicy',{'RoleName':name,'PolicyDocument':json.dumps(updated_trust)})
    except ClientError as error:
        if error.response['Error']['Code']!='NoSuchEntity': raise
        role=(await api('iam','CreateRole',{'RoleName':name,'AssumeRolePolicyDocument':json.dumps(trust),'Description':'GitHub main branch deployment for File Shelter','Tags':tags}))['Role']
    try:
        current_policy=(await api('iam','GetRolePolicy',{'RoleName':name,'PolicyName':'FileShelterDeploy'}))['PolicyDocument']
    except ClientError as error:
        if error.response['Error']['Code']!='NoSuchEntity': raise
        current_policy=None
    if current_policy!=policy:
        await api('iam','PutRolePolicy',{'RoleName':name,'PolicyName':'FileShelterDeploy','PolicyDocument':json.dumps(policy)})
    created[name]={'arn':role['Arn'],'validationFindings':validation['findings']}
result={'providerArn':provider,'roles':created}
result

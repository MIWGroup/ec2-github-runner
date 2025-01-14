const AWS = require('aws-sdk');
const core = require('@actions/core');
const config = require('./config');

// User data scripts are run as the root user
function buildUserDataScript(githubRegistrationToken, label) {
  if (config.input.runnerHomeDir) {
    // If runner home directory is specified, we expect the actions-runner software (and dependencies)
    // to be pre-installed in the AMI, so we simply cd into that directory and then start the runner
    return [
      '#!/bin/bash',
      'su - ubuntu',
      `su - ubuntu -c 'sudo mkdir -p /mnt/yocto-cache/ && sudo mount /dev/nvme1n1 /mnt/yocto-cache'`,
      'su - ubuntu -c "cd actions-runner && curl -O -L https://github.com/actions/runner/releases/download/v2.286.0/actions-runner-linux-x64-2.286.0.tar.gz && tar xzf ./actions-runner-linux-x64-2.286.0.tar.gz"',
      `su - ubuntu -c 'cd "${config.input.runnerHomeDir}" && ./config.sh --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label}'`,
      `su - ubuntu -c 'cd "${config.input.runnerHomeDir}" && ./run.sh'`,
    ];
  } else {
    return [
      '#!/bin/bash',
      'su - ubuntu',
      'whoami',
      'su - ubuntu -c "mkdir actions-runner && cd actions-runner && curl -O -L https://github.com/actions/runner/releases/download/v2.286.0/actions-runner-linux-x64-2.286.0.tar.gz && tar xzf ./actions-runner-linux-x64-2.286.0.tar.gz"',
      `su - ubuntu -c 'cd actions-runner && ./config.sh --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label}'`,
      "su - ubuntu -c 'cd actions-runner && ./run.sh'",
    ];
  }
}

async function startEc2Instance(label, githubRegistrationToken) {
  const ec2 = new AWS.EC2();

  const userData = buildUserDataScript(githubRegistrationToken, label);
  core.info(`${userData}`);
  const params = {
    ImageId: config.input.ec2ImageId,
    InstanceType: config.input.ec2InstanceType,
    MinCount: 1,
    MaxCount: 1,
    UserData: Buffer.from(userData.join('\n')).toString('base64'),
    SubnetId: config.input.subnetId,
    SecurityGroupIds: [config.input.securityGroupId],
    IamInstanceProfile: { Name: config.input.iamRoleName },
    TagSpecifications: config.tagSpecifications,
  };

  try {
    
    const ec2InstanceId = await ec2.runInstances(params).promise().then(async data => {
      const ec2InstanceId = data.Instances[0].InstanceId;
      core.info(`AWS EC2 instance ${ec2InstanceId} is started`);
      const waitParams = {
        InstanceIds: [ec2InstanceId],
      };
      await ec2.waitFor("instanceRunning", waitParams).promise()
      var volumeParams = {
        Device: "/dev/sdf", 
        InstanceId: ec2InstanceId, 
        VolumeId: config.input.ec2VolumeId
       };
      await ec2.attachVolume(volumeParams).promise()
      core.info(`Volume attached`);
      return ec2InstanceId
    });
    
    
    // if (config.input.ec2VolumeId) {
    //   const waitParams = {
    //     InstanceIds: [ec2InstanceId],
    //   };
    //   var volumeParams = {
    //     Device: "/dev/sdf", 
    //     InstanceId: ec2InstanceId, 
    //     VolumeId: config.input.ec2VolumeId
    //    };
    //   const wres = await ec2.waitFor("instanceRunning", waitParams).promise().then(return await ec2.attachVolume(volumeParams).promise())
      

    return ec2InstanceId;
  } catch (error) {
    core.error('AWS EC2 instance starting error');
    throw error;
  }
}

async function terminateEc2Instance() {
  const ec2 = new AWS.EC2();

  const params = {
    InstanceIds: [config.input.ec2InstanceId],
  };

  try {
    await ec2.terminateInstances(params).promise().then(async (data) => {
      if (config.input.ec2VolumeId) {
        var volumeParams = {
          InstanceId: ec2InstanceId, 
          VolumeId: config.input.ec2VolumeId
         };
        await ec2.detachVolume(volumeParams).promise()
        core.info(`${config.input.ec2VolumeId} detached from ${ec2InstanceId}`);
  
      }
    });
    core.info(`AWS EC2 instance ${config.input.ec2InstanceId} is terminated`);
    return;
  } catch (error) {
    core.error(`AWS EC2 instance ${config.input.ec2InstanceId} termination error`);
    throw error;
  }
}

async function waitForInstanceRunning(ec2InstanceId) {
  const ec2 = new AWS.EC2();

  const params = {
    InstanceIds: [ec2InstanceId],
  };

  try {
    await ec2.waitFor('instanceRunning', params).promise();
    core.info(`AWS EC2 instance ${ec2InstanceId} is up and running`);
    return;
  } catch (error) {
    core.error(`AWS EC2 instance ${ec2InstanceId} initialization error`);
    throw error;
  }
}

module.exports = {
  startEc2Instance,
  terminateEc2Instance,
  waitForInstanceRunning,
};

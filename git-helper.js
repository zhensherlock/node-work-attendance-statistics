const shell = require('shelljs');
const util = require('util');

exports.handle = _handle;

function _handle(params) {
    const format = 'Auto-commit: %s'
        , message = params.message
        , commitMessage = util.format(format, message)
    ;

    // 判断git是否可用
    if (!shell.which('git')) {
        new Error('Sorry, this script requires git');
        return false;
    }

    // 执行commit命令
    if (shell.exec(util.format('git commit -am "%s"', commitMessage)).code !== 0) {
        new Error('Error: Git commit failed');
        return false;
    }

    // 推到远端服务器上
    if (shell.exec('git push origin master').code !== 0) {
        new Error('Error: Git push failed');
        return false;
    }

    return true;
}

_handle({
    message: 'test'
});
const shell = require('shelljs');
const util = require('util');

exports.handle = _handle;

function _handle(params) {
    const format = 'Auto-commit: %s'
        , message = params.message
        , commitMessage = util.format(format, message)
    ;
    if (!shell.which('git')) {
        shell.echo('Sorry, this script requires git');
        shell.exit(1);
    }

    if (shell.exec(util.format('git commit -am "%s"', commitMessage)).code !== 0) {
        shell.echo('Error: Git commit failed');
        shell.exit(1);
    }
}

_handle('test')
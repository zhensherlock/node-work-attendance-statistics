const util = require('util');
const request = require('request');
const jsdom = require("jsdom");
const moment = require("moment");
const colors = require('colors');
const gitHelper = require('./git-helper');
const schedule = require('node-schedule');
const _ = require('lodash');
// moment.locale('zh-cn');
const fs = require('fs');
const argv = require('yargs').argv;
const { JSDOM } = jsdom;
const attendanceAPIPHPSESSID = 'bbus2ologohce4o1lh85lntkv1';
const attendanceAPIURL = 'http://kq.qycn.com/weixin/weixin/record';
const holidayAPIKey = 'f74e319fd1f1563f9ce99843e9e917e5';
const holidayAPIURL = 'http://v.juhe.cn/calendar/month?year-month=%s&key=%s';

_init();

/**
 * 程序主入口
 * 定时任务：--schema=cycle
 * @private
 */
function _init() {
    if (argv.hasOwnProperty('check')) {
        // 检查数据
        _checkData()
    }
    else if (argv.hasOwnProperty('schema') && argv.schema == 'cycle') {
        // 定时任务
        _cycleRun();
    } else {
        // 运行单次
        _calcData();
    }
}

/**
 * 检查数据
 * @private
 */
function _checkData() {
    const filePath = 'static/db.json';
    let dbResult = JSON.parse(fs.readFileSync(filePath));

    for (let item of Object.values(dbResult)) {
        let recordItem = {
            startTime: moment(item.startTime),
            endTime: moment(item.endTime)
        };
        let recordMinutes = _getRecordMinutes(recordItem);
        item.minutes = recordMinutes;
        item.hours = recordMinutes / 60;
    }

    fs.writeFileSync(filePath, JSON.stringify(dbResult));
}

/**
 * 定时执行
 * @private
 */
function _cycleRun() {
    var rule = new schedule.RecurrenceRule();
    rule.minute = 59;
    schedule.scheduleJob(rule, function(){
        _calcData();
    });
}


/**
 * 计算签到数据入口
 * @returns {Promise.<void>}
 * @private
 */
async function _calcData() {
    const currentDate = argv.hasOwnProperty('date') ? new Date(argv.date) : new Date()
        , recordData = await _recordData(currentDate)
        , recordHolidayData = await _recordHolidayData(currentDate)
        , dateRange = _getDateRange(currentDate)
        , startTime = dateRange.startTime.format('YYYY/MM/DD')
        , endTime = dateRange.endTime.format('YYYY/MM/DD')
        , sumData = _getSumData({ recordData, recordHolidayData, dateRange, currentDate })
        , rangeContext = `
当月记录范围：${startTime} - ${endTime}
当月已上班时间：${sumData.workedHours}小时
当月应上班时间：${sumData.allHours}小时
当月剩余还需上班时间：${sumData.surplusHours}小时
建议剩余每日上班时间：${sumData.surplusHours / sumData.surplusDays}小时
`
    ;

    console.log(colors.red.bold(rangeContext.trim()));

    // 自动提交代码
    // gitHelper.handle({
    //     message: 'update database'
    // });
}

/**
 * 获取已打卡时间、应上班时间和还需要上班时间
 * @param recordData
 * @param recordHolidayData
 * @param dateRange
 * @param currentDate
 * @returns {{workedHours: number, workedDays: number, allHours: number, allDays: number, surplusHours: number, surplusDays: number}}
 * @private
 */
function _getSumData({ recordData, recordHolidayData, dateRange, currentDate }) {
    var startTime = dateRange.startTime
        , endTime = dateRange.endTime
        , result = { workedHours: 0, spendDays: 0, allHours: 0, allDays: 0, surplusHours: 0, surplusDays: 0 }
        , currentDayData
    ;
    while (startTime <= endTime) {
        // 休假日需要上班标识
        let holidayNeedWork = recordHolidayData.hasOwnProperty(startTime.format('YYYY/MM/DD')) &&
            recordHolidayData[startTime.format('YYYY/MM/DD')].status == 'work'
        currentDayData = recordData[startTime.format('YYYY/MM/DD')];
        // 记录已打卡时间
        if (currentDayData) {
            result.workedHours += currentDayData.hours;
        }

        // 记录应上班时间，工作添加8小时
        if ([0, 6].indexOf(startTime.days()) == -1 || holidayNeedWork) {
            result.allHours += 8;
            result.allDays++;
            // 记录度过的时间
            if (startTime < currentDate) {
                result.spendDays += 1;
            }
        }

        // 进入下一天
        startTime.add(1, 'days');
    }

    // 计算剩余还需上班时间
    result.surplusHours = result.allHours - result.workedHours;
    result.surplusDays = result.allDays - result.spendDays;

    return result;
}

/**
 * 获取近期假期并保存到本地
 * @param currentDate
 * @returns {Promise<any>}
 * @private
 */
function _recordHolidayData(currentDate) {
    const filePath = 'static/holidaydb.json';
    var requestJar = request.jar()
        , dbResult = JSON.parse(fs.readFileSync(filePath))
        , month = moment(currentDate).format('YYYY-M')
    ;

    return new Promise((resolve, reject) => {
        request({
            url: util.format(holidayAPIURL, month, holidayAPIKey),
            method: 'GET',
            jar: requestJar
        }, (error, response, body) => {

            if (error) {
                reject(error);
            }

            var bodyObject = JSON.parse(body)
                , holidays = []
            ;

            if (bodyObject.reason != 'Success') {
                return;
            }

            // month = moment(new Date(month));

            holidays = JSON.parse(bodyObject.result.data.holiday);

            holidays.forEach((holidayItem) => {
                holidayItem.list.forEach((dayItem) => {
                    var day = moment(new Date(dayItem.date));

                    // 如果不是当月的数据，则不记录
                    // if (month.month() != day.month()) {
                    //     return;
                    // }

                    dbResult[day.format('YYYY/MM/DD')] = {
                        status: _getDayStatus(dayItem.status)
                    };
                });
            });

            fs.writeFileSync(filePath, JSON.stringify(dbResult));

            resolve(dbResult);

        });
    });
}

/**
 * 获取考勤记录并保存到本地
 * @returns {Promise}
 * @private
 */
function _recordData(currentDate) {
    const filePath = 'static/db.json';

    var requestJar = request.jar()
        , cookie = request.cookie('PHPSESSID=' + attendanceAPIPHPSESSID)
        , dbResult = JSON.parse(fs.readFileSync(filePath))
    ;

    requestJar.setCookie(cookie, attendanceAPIURL);

    return new Promise((resolve, reject) => {
        request({
            url: attendanceAPIURL,
            method: 'GET',
            jar: requestJar
        }, (error, response, body) => {

            if (error) {
                reject(error);
            }

            const dom = new JSDOM(body)
                , monthDom = dom.window.document.querySelector('#month-tab')
                , domListGroupItems = monthDom.querySelectorAll('.list-group-item')
            ;
            var domItemIndex = domListGroupItems.length - 1
                , dateData = {}
                , domItem
            ;
            // 移除多余的DOM节点
            monthDom.querySelectorAll('.badge').forEach((badgeItem) => {
                badgeItem.parentNode.removeChild(badgeItem);
            });

            while (domItemIndex >= 0) {
                domItem = domListGroupItems[domItemIndex];
                _handleDayDate({
                    currentDate,
                    domItem,
                    dbResult,
                    dateData
                });
                domItemIndex--;
            }

            fs.writeFileSync(filePath, JSON.stringify(dbResult));

            resolve(dbResult);

        });
    });
}

/**
 * 根据日期获取考勤的开始时间和考勤的结束时间
 * @param date
 * @returns {{startTime: *, endTime: *}}
 * @private
 */
function _getDateRange(date) {
    const currentDay = date.getDate()
        , currentYear = date.getFullYear()
        , currentMonth = date.getMonth() + 1
        , startDayNumber = 26
        , endDayNumber = 25
    ;
    var startTime
        , endTime
    ;
    /**
     * 当日期大于等于26号，取值范围是：当月26号到下月25号
     * 当日期小于26号，取值范围是：上月26号到当月25号
     */
    if (currentDay >= 26) {
        startTime = moment(new Date(currentYear + '/' + currentMonth + '/' + startDayNumber));
        endTime = _.cloneDeep(startTime).add(1, 'months').set('date', 25)
        // endTime = moment(new Date(currentYear + '/' + (currentMonth + 1) + '/' + endDayNumber));
    }
    else {
        endTime = moment(new Date(currentYear + '/' + currentMonth + '/' + endDayNumber));
        startTime = _.cloneDeep(endTime).subtract(1, 'months').set('date', 26);
        // startTime = moment(new Date(currentYear + '/' + (currentMonth - 1) + '/' + startDayNumber));
    }
    return { startTime, endTime };
}

/**
 * 获取某天的已上班时间、签到时间和签退时间
 * @param domItem
 * @param dbResult
 * @param dateData
 * @private
 */
function _handleDayDate({ currentDate, domItem, dbResult, dateData }) {
    const itemTextContext = domItem.innerHTML
        , texts = itemTextContext.split(' ')
        , currentYear = currentDate.getFullYear()
        , date = currentYear + '/' + texts[1].replace('-', '/')
        , time = texts[2]
    ;

    let recordMinutes;

    // 如果没有当前时间的数据，先设置开始时间
    if (!dateData[date]) {
        dateData[date] = {
            startTime: moment(new Date(date + ' ' + time))
        };
        return;
    }

    // 如果有当前时间的数据，再设置结束时间
    if (dateData[date]) {
        dateData[date].endTime = moment(new Date(date + ' ' + time));
    }

    // 判断开始时间和结束时间是否颠倒
    if (dateData[date].startTime > dateData[date].endTime) {
        _mutualReplace(dateData[date]);
    }

    recordMinutes = _getRecordMinutes(dateData[date]);

    dbResult[date] = {
        minutes: recordMinutes,
        hours: recordMinutes / 60,
        startTime: dateData[date].startTime.format('YYYY/MM/DD HH:mm'),
        endTime: dateData[date].endTime.format('YYYY/MM/DD HH:mm')
    };
}

/**
 * 根据签到时间和签退时间计算出上班时间，扣除中午1小时休息时间，单位：分钟
 * @param date
 * @returns {*|number}
 * @private
 */
function _getRecordMinutes(date) {
    const startTime = date.startTime
        , endTime = date.endTime
    ;
    var diffMinutes = endTime.diff(startTime, 'minutes');
    // 删除中午的1小时
    diffMinutes = diffMinutes - 60;

    return diffMinutes;
}

/**
 * 颠倒开始时间和结束时间
 * @param date
 * @private
 */
function _mutualReplace(date) {
    const startTime = date.startTime;
    date.startTime = date.endTime;
    date.endTime = startTime;
}

/**
 * 根据API返回数据状态返回日期状态字符串
 * @param status
 * @returns {string}
 * @private
 */
function _getDayStatus(status) {
    var result = '';
    switch (true) {
        case status == 2:
            result = 'work';
            break;
        case status == 1:
            result = 'rest';
            break;
    }
    return result;
}
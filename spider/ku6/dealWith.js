/**
 * Created by yunsong on 16/7/28.
 */
const async = require('async');
const request = require('../../lib/request');
const spiderUtils = require('../../lib/spiderUtils');

let logger;
class dealWith {
  constructor(spiderCore) {
    this.core = spiderCore;
    this.settings = spiderCore.settings;
    logger = this.settings.logger;
    logger.trace('DealWith instantiation ...');
  }
  todo(task, callback) {
    task.total = 0;
    async.parallel({
      user: (callback) => {
        this.getUser(task, task.id, (err) => {
          if (err) {
            return callback(err);
          }
          callback(null, '用户信息已返回');
        });
      },
      media: (callback) => {
        this.getTotal(task, task.id, (err) => {
          if (err) {
            return callback(err);
          }
          callback(null, '视频信息已返回');
        });
      }
    }, (err, result) => {
      if (err) {
        return callback(err);
      }
      logger.debug('result : ', result);
      callback(null, task.total);
    });
  }
  getUser(task, id, callback) {
    const option = {
      url: this.settings.spiderAPI.ku6.fansNum + id
    };
    request.get(logger, option, (err, result) => {
      if (err) {
        callback(err);
        return;
      }
      try {
        result = JSON.parse(result.body);
      } catch (e) {
        logger.debug('粉丝数请求失败');
        callback(e);
        return;
      }
      if (!result.data) {
        callback();
        return;
      }
      const fans = result.data.subscriptions ? result.data.subscriptions : '',
        user = {
          platform: 14,
          bid: task.id,
          fans_num: spiderUtils.numberHandling(fans)
        };
      this.sendUser(user, (err, result) => {
        callback();
      });
      this.sendStagingUser(user);
    });
  }
  sendUser(user, callback) {
    const option = {
      url: this.settings.sendFans,
      data: user
    };
    request.post(logger, option, (err, result) => {
      if (err) {
        return callback(err);
      }
      try {
        result = JSON.parse(result.body);
      } catch (e) {
        logger.error('json数据解析失败');
        logger.info('send error:', result);
        return callback(e);
      }
      if (result.errno == 0) {
        logger.debug('酷6用户:', `${user.bid} back_end`);
      } else {
        logger.error('酷6用户:', `${user.bid} back_error`);
        logger.info(result);
      }
      callback();
    });
  }
  sendStagingUser(user) {
    const option = {
      url: 'http://staging-dev.meimiaoip.com/index.php/Spider/Fans/postFans',
      data: user
    };
    request.post(logger, option, (err, result) => {
      if (err) {
        return;
      }
      try {
        result = JSON.parse(result.body);
      } catch (e) {
        logger.error('json数据解析失败');
        logger.info('send error:', result);
        return;
      }
      if (result.errno == 0) {
        logger.debug('用户:', `${user.bid} back_end`);
      } else {
        logger.error('用户:', `${user.bid} back_error`);
        logger.info(result);
      }
    });
  }
  getTotal(task, id, callback) {
    logger.debug('开始获取视频总数');
    const option = {
      url: this.settings.spiderAPI.ku6.listNum + id,
      referer: `http://v.ku6.com/u/${task.id}/profile.html`,
      ua: 1
    };
    request.get(logger, option, (err, result) => {
      if (err) {
        return callback(err);
      }
      try {
        result = JSON.parse(result.body);
      } catch (e) {
        logger.error('json数据解析失败');
        logger.info('json1 error :', result.body);
        return callback(e);
      }
      const total = result.data.videoCount;
      task.total = total;
      this.getList(task, total, (err) => {
        if (err) {
          return callback(err);
        }
        callback(null, '视频信息已返回');
      });
    });
  }
  getList(task, total, callback) {
    let sign = 1,
      newSign = 0,
      page,
      option,
      list;
    if (total % 20 == 0) {
      page = total / 20;
    } else {
      page = Math.ceil(total / 20);
    }
    async.whilst(
            () => sign <= Math.min(page, 500),
            (cb) => {
              logger.debug(`开始获取第${sign}页视频列表`);
              option = {
                url: `${this.settings.spiderAPI.ku6.allInfo + task.id}&pn=${newSign}`
              };
              request.get(logger, option, (err, result) => {
                if (err) {
                  return cb();
                }
                try {
                  result = JSON.parse(result.body);
                } catch (e) {
                  logger.error('json数据解析失败');
                  logger.info('json error: ', result.body);
                  sign++;
                  newSign++;
                  return cb();
                }
                list = result.data;
                if (list) {
                  this.deal(task, list, () => {
                    sign++;
                    newSign++;
                    cb();
                  });
                } else {
                  sign++;
                  newSign++;
                  cb();
                }
              });
            },
            (err, result) => {
              callback();
            }
        );
  }
  deal(task, list, callback) {
    let index = 0;
    async.whilst(
            () => index < list.length,
            (cb) => {
              this.getInfo(task, list[index], (err) => {
                index++;
                cb();
              });
            },
            (err, result) => {
              callback();
            }
        );
  }
  getInfo(task, data, callback) {
    let time = data.uploadtime,
      a_create_time = time.substring(0, 10),
      media = {
        author: data.nick,
        platform: 14,
        bid: task.id,
        aid: data.vid,
        title: data.title ? data.title.substr(0, 100).replace(/"/g, '') : 'btwk_caihongip',
        desc: data.desc.substr(0, 100).replace(/"/g, ''),
        play_num: data.viewed,
        support: data.liked,
        step: data.disliked,
        a_create_time,
        long_t: data.videotime,
        v_img: this._v_img(data.picpath),
        tag: this._tag(data.tag),
        class: this._class(data.catename)
      };
    spiderUtils.saveCache(this.core.cache_db, 'cache', media);
    spiderUtils.commentSnapshots(this.core.taskDB,
      { p: media.platform, aid: media.aid, comment_num: media.comment_num });
    callback();
  }
  _tag(raw) {
    if (!raw) {
      return '';
    }
    raw = raw.split(' ');
    const _tagArr = [];
    if (raw.length != 0) {
      for (const i in raw) {
        _tagArr.push(raw[i]);
      }
      return _tagArr.join(',');
    }
    return '';
  }
  _class(raw) {
    if (typeof raw === 'string') {
      return raw;
    }
    if (Object.prototype.toString.call(raw) === '[object Array]') {
      return raw.join(',');
    }
    return '';
  }
  _v_img(raw) {
    if (!raw) {
      return '';
    }
    if (!raw.startsWith('http://') || !raw.startsWith('https://')) {
      return `http://${raw}`;
    }
    return raw;
  }
}
module.exports = dealWith;
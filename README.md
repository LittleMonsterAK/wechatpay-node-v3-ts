# 微信支付 v3

## 前言
微信官方在2020-12-25正式开放了[v3](https://pay.weixin.qq.com/wiki/doc/apiv3/index.shtml)版本的接口,相比较旧版本[v2](https://pay.weixin.qq.com/wiki/doc/api/index.html)有了不少改变,例如：
* 遵循统一的Restful的设计风格
* 使用JSON作为数据交互的格式，不再使用XML
* 使用基于非对称密钥的SHA256-RSA的数字签名算法，不再使用MD5或HMAC-SHA256
* 不再要求HTTPS客户端证书
* 使用AES-256-GCM，对回调中的关键信息进行加密保护

由于官方文档只支持java和php,所以我在这里使用ts简单的封装了一个版本（参数处理和参数加密),支持在js或者ts中使用,后续会更加完善这个npm包，谢谢。

## 使用
`yarn add wechatpay-node-v3`(也可以用npm)

```bash
import WxPay from 'wechatpay-node-v3';
import fs from 'fs';
import request from 'superagent';

const pay = new WxPay({
  appid: '直连商户申请的公众号或移动应用appid',
  mchid: '商户号',
  serial_no: '证书序列号',
  publicKey: fs.readFileSync('./apiclient_cert.pem'), // 公钥
  privateKey: fs.readFileSync('./apiclient_key.pem'), // 秘钥
});

# 这里以h5支付为例
try {
    # 参数介绍请看h5支付文档 https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter3_3_1.shtml
    const params = {
      appid: '直连商户申请的公众号或移动应用appid',
      mchid: '商户号',
      description: '测试',
      out_trade_no: '订单号',
      notify_url: '回调url',
      amount: {
        total: 1,
      },
      scene_info: {
        payer_client_ip: 'ip',
        h5_info: {
          type: 'Wap',
          app_name: '网页名称 例如 百度',
          app_url: '网页域名 例如 https://www.baidu.com',
        },
      },
    };
    const nonce_str = Math.random().toString(36).substr(2, 15), // 随机字符串
      timestamp = parseInt(+new Date() / 1000 + '').toString(), // 时间戳 秒
      url = '/v3/pay/transactions/h5';

    # 获取签名
    const signature = pay.getSignature('POST', nonce_str, timestamp, url, params);
    # 获取头部authorization 参数
    const authorization = pay.getAuthorization(nonce_str, timestamp, signature);

    const result = await request
      .post('https://api.mch.weixin.qq.com/v3/pay/transactions/h5')
      .send(params)
      .set({
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36',
        Authorization: authorization,
      });

    console.log('result==========>', result.body);
  } catch (error) {
    console.log(error);
  }
```

## 注意
1. serial_no是证书序列号 请在命令窗口使用 `openssl x509 -in apiclient_cert.pem -noout -serial` 获取
2. 头部参数需要添加 User-Agent 参数

## ^1.0.0使用介绍
暂时只更新了微信文档使用新模式的接口（其他新接口由于暂时用不上就没有写）。至于支付回调没有写是因为支付成功了，接收不到回调通知，和微信客服交流没有回答我。（以后测试成功会更新出来）
| api名称 | 函数名 |
|--|--|
| [h5支付](https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter3_3_1.shtml) |[transactions_h5](https://github.com/klover2/wechatpay-node-v3-ts/blob/master/docs/transactions_h5.md)  |
| [native支付](https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter3_4_1.shtml) |[transactions_native](https://github.com/klover2/wechatpay-node-v3-ts/blob/master/docs/transactions_native.md)  |
| [app支付](https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter3_2_1.shtml) |[transactions_app](https://github.com/klover2/wechatpay-node-v3-ts/blob/master/docs/transactions_app.md)  |
| [JSAPI支付 或者 小程序支付](https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter3_1_1.shtml) |[transactions_jsapi](https://github.com/klover2/wechatpay-node-v3-ts/blob/master/docs/transactions_jsapi.md)  |
| [查询订单](https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter3_1_1.shtml) |[query](https://github.com/klover2/wechatpay-node-v3-ts/blob/master/docs/query.md)  |
| [关闭订单](https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter3_1_1.shtml) |[close](https://github.com/klover2/wechatpay-node-v3-ts/blob/master/docs/close.md)  |
| [申请交易账单](https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter3_1_6.shtml) |[tradebill](https://github.com/klover2/wechatpay-node-v3-ts/blob/master/docs/tradebill.md)  |
| [申请资金账单](https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter3_1_7.shtml) |[fundflowbill](https://github.com/klover2/wechatpay-node-v3-ts/blob/master/docs/fundflowbill.md)  |
| [下载账单](https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter3_1_8.shtml) |[downloadbill](https://github.com/klover2/wechatpay-node-v3-ts/blob/master/docs/downloadbill.md)  |

## 版本介绍
| 版本介绍 |版本号  |
|--|--|
| v0.0.1 | 仅支持签名和获取头部参数Authorization |
|v1.0.0|增加了支付(不包括合单支付)、查询订单、关闭订单、申请交易账单、申请资金账单、下载账单|

## 文档
[v2支付文档](https://pay.weixin.qq.com/wiki/doc/api/index.html)
[v3支付文档](https://pay.weixin.qq.com/wiki/doc/apiv3/index.shtml)

## 其他推荐
[微信v2支付npm包](https://www.npmjs.com/package/node-wxpay3)
[支付宝npm包](https://www.npmjs.com/package/node-alipay1)
[快递鸟npm包](https://www.npmjs.com/package/node-kdniao)
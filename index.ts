'use strict';
import crypto from 'crypto';
import request from 'superagent';
const x509_1 = require('@fidm/x509');

import { Ipay, Ih5, Inative, Ijsapi, Iquery1, Iquery2, Itradebill, Ifundflowbill, Iapp, Ioptions, Irefunds1, Irefunds2 } from './lib/interface';
import { IcombineH5, IcombineNative, IcombineApp, IcombineJsapi, IcloseSubOrders } from './lib/combine_interface';

class Pay {
  private appid: string; //  直连商户申请的公众号或移动应用appid。
  private mchid: string; // 商户号
  private serial_no = ''; // 证书序列号
  private publicKey?: Buffer; // 公钥
  private privateKey?: Buffer; // 密钥
  private authType = 'WECHATPAY2-SHA256-RSA2048'; // 认证类型，目前为WECHATPAY2-SHA256-RSA2048
  private userAgent = '127.0.0.1'; // User-Agent
  private key?: string; // APIv3密钥
  private static certificates: { [key in string]: string } = {}; // 商户平台证书 key 是 serialNo, value 是 publicKey
  /**
   * 构造器
   * @param appid 直连商户申请的公众号或移动应用appid。
   * @param mchid 商户号
   * @param publicKey 公钥
   * @param privateKey 密钥
   * @param optipns 可选参数 object 包括下面参数
   *
   * @param serial_no  证书序列号
   * @param authType 可选参数 认证类型，目前为WECHATPAY2-SHA256-RSA2048
   * @param userAgent 可选参数 User-Agent
   * @param key 可选参数 APIv3密钥
   */
  public constructor(appid: string, mchid: string, publicKey: Buffer, privateKey: Buffer, optipns?: Ioptions);
  /**
   * 构造器
   * @param obj object类型 包括下面参数
   *
   * @param appid 直连商户申请的公众号或移动应用appid。
   * @param mchid 商户号
   * @param serial_no  可选参数 证书序列号
   * @param publicKey 公钥
   * @param privateKey 密钥
   * @param authType 可选参数 认证类型，目前为WECHATPAY2-SHA256-RSA2048
   * @param userAgent 可选参数 User-Agent
   * @param key 可选参数 APIv3密钥
   */
  public constructor(obj: Ipay);
  constructor(arg1: Ipay | string, mchid?: string, publicKey?: Buffer, privateKey?: Buffer, optipns?: Ioptions) {
    if (arg1 instanceof Object) {
      this.appid = arg1.appid;
      this.mchid = arg1.mchid;
      if (arg1.serial_no) this.serial_no = arg1.serial_no;
      this.publicKey = arg1.publicKey;
      if (!this.publicKey) throw new Error('缺少公钥');
      this.privateKey = arg1.privateKey;
      if (!arg1.serial_no) this.serial_no = this.getSN(this.publicKey);

      this.authType = arg1.authType || 'WECHATPAY2-SHA256-RSA2048';
      this.userAgent = arg1.userAgent || '127.0.0.1';
      this.key = arg1.key;
    } else {
      const _optipns = optipns || {};
      this.appid = arg1;
      this.mchid = mchid || '';
      this.publicKey = publicKey;
      this.privateKey = privateKey;

      this.authType = _optipns.authType || 'WECHATPAY2-SHA256-RSA2048';
      this.userAgent = _optipns.userAgent || '127.0.0.1';
      this.key = _optipns.key;
      this.serial_no = _optipns.serial_no || '';
      if (!this.publicKey) throw new Error('缺少公钥');
      if (!this.serial_no) this.serial_no = this.getSN(this.publicKey);
    }
  }
  /**
   * 拉取平台证书到 Pay.certificates 中
   * @param apiSecret APIv3密钥
   */
  private async fetchCertificates(apiSecret?: string) {
    const url = 'https://api.mch.weixin.qq.com/v3/certificates';
    const authorization = this.init('GET', url);
    const result = await this.getRequest(url, authorization);

    if (result.status === 200) {
      const data = result.data as {
        effective_time: string;
        expire_time: string;
        serial_no: string;
        encrypt_certificate: {
          algorithm: string;
          associated_data: string;
          ciphertext: string;
          nonce: string;
        };
      }[];

      const newCertificates = {} as { [key in string]: string };

      data.forEach(item => {
        const decryptCertificate = this.decipher_gcm<string>(
          item.encrypt_certificate.ciphertext,
          item.encrypt_certificate.associated_data,
          item.encrypt_certificate.nonce,
          apiSecret,
        );

        newCertificates[item.serial_no] = x509_1.Certificate.fromPEM(Buffer.from(decryptCertificate)).publicKey.toPEM();
      });

      Pay.certificates = {
        ...Pay.certificates,
        ...newCertificates,
      };
    } else {
      throw new Error('拉取平台证书失败');
    }
  }
  /**
   * 验证签名，提醒：node 取头部信息时需要用小写，例如：req.headers['wechatpay-timestamp']
   * @param params.timestamp HTTP头Wechatpay-Timestamp 中的应答时间戳
   * @param params.nonce HTTP头Wechatpay-Nonce 中的应答随机串
   * @param params.body 应答主体（response Body），需要按照接口返回的顺序进行验签，错误的顺序将导致验签失败。
   * @param params.serial HTTP头Wechatpay-Serial 证书序列号
   * @param params.signature HTTP头Wechatpay-Signature 签名
   * @param params.apiSecret APIv3密钥，如果在 构造器 中有初始化该值(this.key)，则可以不传入。当然传入也可以
   */
  public async verifySign(params: {
    timestamp: string | number;
    nonce: string;
    body: Record<string, any> | string;
    serial: string;
    signature: string;
    apiSecret?: string;
  }) {
    const { timestamp, nonce, body, serial, signature, apiSecret } = params;

    let publicKey = Pay.certificates[serial];

    if (!publicKey) {
      await this.fetchCertificates(apiSecret);
    }

    publicKey = Pay.certificates[serial];

    if (!publicKey) {
      throw new Error('平台证书序列号不相符，未找到平台序列号');
    }

    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    const data = `${timestamp}\n${nonce}\n${bodyStr}\n`;
    const verify = crypto.createVerify('RSA-SHA256');
    verify.update(data);

    return verify.verify(publicKey, signature, 'base64');
  }
  /**
   * 构建请求签名参数
   * @param method Http 请求方式
   * @param url 请求接口 例如/v3/certificates
   * @param timestamp 获取发起请求时的系统当前时间戳
   * @param nonceStr 随机字符串
   * @param body 请求报文主体
   */
  public getSignature(method: string, nonce_str: string, timestamp: string, url: string, body?: string | Record<string, any>): string {
    let str = method + '\n' + url + '\n' + timestamp + '\n' + nonce_str + '\n';
    if (body && body instanceof Object) body = JSON.stringify(body);
    if (body) str = str + body + '\n';
    if (method === 'GET') str = str + '\n';
    return this.sha256WithRsa(str);
  }
  // jsapi 和 app 支付参数签名 加密自动顺序如下 不能错乱
  // 应用id
  // 时间戳
  // 随机字符串
  // 预支付交易会话ID
  private sign(str: string) {
    // let str = '';
    // const exclude = ['signType', 'paySign', 'status', 'package', 'partnerid'];
    // for (const key in params) {
    //   if (!exclude.includes(key)) {
    //     str = str + params[key] + '\n';
    //   }
    // }
    return this.sha256WithRsa(str);
  }
  // 获取序列号
  public getSN(fileData?: string | Buffer): string {
    if (!fileData && !this.publicKey) throw new Error('缺少公钥');
    if (!fileData) fileData = this.publicKey;
    if (typeof fileData == 'string') {
      fileData = Buffer.from(fileData);
    }

    const certificate = x509_1.Certificate.fromPEM(fileData);
    return certificate.serialNumber;
  }
  /**
   * SHA256withRSA
   * @param data 待加密字符
   * @param privatekey 私钥key  key.pem   fs.readFileSync(keyPath)
   */
  public sha256WithRsa(data: string): string {
    if (!this.privateKey) throw new Error('缺少秘钥文件');
    return crypto
      .createSign('RSA-SHA256')
      .update(data)
      .sign(this.privateKey, 'base64');
  }
  /**
   * 获取授权认证信息
   * @param nonceStr  请求随机串
   * @param timestamp 时间戳
   * @param signature 签名值
   */
  public getAuthorization(nonce_str: string, timestamp: string, signature: string): string {
    const _authorization =
      'mchid="' +
      this.mchid +
      '",' +
      'nonce_str="' +
      nonce_str +
      '",' +
      'timestamp="' +
      timestamp +
      '",' +
      'serial_no="' +
      this.serial_no +
      '",' +
      'signature="' +
      signature +
      '"';
    return this.authType.concat(' ').concat(_authorization);
  }
  /**
   * 回调解密
   * @param ciphertext  Base64编码后的开启/停用结果数据密文
   * @param associated_data 附加数据
   * @param nonce 加密使用的随机串
   * @param key  APIv3密钥
   */
  public decipher_gcm<T extends any>(ciphertext: string, associated_data: string, nonce: string, key?: string): T {
    if (key) this.key = key;
    if (!this.key) throw new Error('缺少key');

    const _ciphertext = Buffer.from(ciphertext, 'base64');

    // 解密 ciphertext字符  AEAD_AES_256_GCM算法
    const authTag: any = _ciphertext.slice(_ciphertext.length - 16);
    const data = _ciphertext.slice(0, _ciphertext.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, nonce);
    decipher.setAuthTag(authTag);
    decipher.setAAD(Buffer.from(associated_data));
    const decoded = decipher.update(data, undefined, 'utf8');
    decipher.final();

    try {
      return JSON.parse(decoded);
    } catch (e) {
      return decoded as T;
    }
  }
  /**
   * 参数初始化
   */
  private init(method: string, url: string, params?: Record<string, any>) {
    const nonce_str = Math.random()
        .toString(36)
        .substr(2, 15),
      timestamp = parseInt(+new Date() / 1000 + '').toString();

    const signature = this.getSignature(method, nonce_str, timestamp, url.replace('https://api.mch.weixin.qq.com', ''), params);
    const authorization = this.getAuthorization(nonce_str, timestamp, signature);
    return authorization;
  }
  /**
   * post 请求
   * @param url  请求接口
   * @param params 请求参数
   */
  private async postRequest(url: string, params: Record<string, any>, authorization: string): Promise<Record<string, any>> {
    try {
      const result = await request
        .post(url)
        .send(params)
        .set({
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': this.userAgent,
          Authorization: authorization,
          'Accept-Encoding': 'gzip',
        });
      return {
        status: result.status,
        ...result.body,
      };
    } catch (error) {
      const err = JSON.parse(JSON.stringify(error));
      return {
        status: err.status,
        ...(err.response.text && JSON.parse(err.response.text)),
      };
    }
  }
  /**
   * get 请求
   * @param url  请求接口
   * @param params 请求参数
   */
  private async getRequest(url: string, authorization: string): Promise<Record<string, any>> {
    try {
      const result = await request.get(url).set({
        Accept: 'application/json',
        'User-Agent': this.userAgent,
        Authorization: authorization,
        'Accept-Encoding': 'gzip',
      });

      let data = {};
      switch (result.type) {
        case 'application/json':
          data = {
            status: result.status,
            ...result.body,
          };
          break;
        case 'text/plain':
          data = {
            status: result.status,
            data: result.text,
          };
          break;
        case 'application/x-gzip':
          data = {
            status: result.status,
            data: result.body,
          };
          break;
        default:
          data = {
            status: result.status,
            ...result.body,
          };
      }
      return data;
    } catch (error) {
      const err = JSON.parse(JSON.stringify(error));
      return {
        status: err.status,
        ...(err.response.text && JSON.parse(err.response.text)),
      };
    }
  }
  // ---------------支付相关接口--------------//
  /**
   * h5支付
   * @param params 请求参数 object 参数介绍 请看文档https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter3_3_1.shtml
   */
  public async transactions_h5(params: Ih5): Promise<Record<string, any>> {
    // 请求参数
    const _params = {
      appid: this.appid,
      mchid: this.mchid,
      ...params,
    };
    const url = 'https://api.mch.weixin.qq.com/v3/pay/transactions/h5';

    const authorization = this.init('POST', url, _params);

    return await this.postRequest(url, _params, authorization);
  }
  /**
   * 合单h5支付
   * @param params 请求参数 object 参数介绍 请看文档https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter5_1_2.shtml
   */
  public async combine_transactions_h5(params: IcombineH5): Promise<Record<string, any>> {
    // 请求参数
    const _params = {
      combine_appid: this.appid,
      combine_mchid: this.mchid,
      ...params,
    };
    const url = 'https://api.mch.weixin.qq.com/v3/combine-transactions/h5';

    const authorization = this.init('POST', url, _params);

    return await this.postRequest(url, _params, authorization);
  }
  /**
   * native支付
   * @param params 请求参数 object 参数介绍 请看文档https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter3_4_1.shtml
   */
  public async transactions_native(params: Inative): Promise<Record<string, any>> {
    // 请求参数
    const _params = {
      appid: this.appid,
      mchid: this.mchid,
      ...params,
    };
    const url = 'https://api.mch.weixin.qq.com/v3/pay/transactions/native';

    const authorization = this.init('POST', url, _params);

    return await this.postRequest(url, _params, authorization);
  }
  /**
   * 合单native支付
   * @param params 请求参数 object 参数介绍 请看文档https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter5_1_5.shtml
   */
  public async combine_transactions_native(params: IcombineNative): Promise<Record<string, any>> {
    // 请求参数
    const _params = {
      combine_appid: this.appid,
      combine_mchid: this.mchid,
      ...params,
    };
    const url = 'https://api.mch.weixin.qq.com/v3/combine-transactions/native';

    const authorization = this.init('POST', url, _params);

    return await this.postRequest(url, _params, authorization);
  }
  /**
   * app支付
   * @param params 请求参数 object 参数介绍 请看文档https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter3_2_1.shtml
   */
  public async transactions_app(params: Iapp): Promise<Record<string, any>> {
    // 请求参数
    const _params = {
      appid: this.appid,
      mchid: this.mchid,
      ...params,
    };
    const url = 'https://api.mch.weixin.qq.com/v3/pay/transactions/app';

    const authorization = this.init('POST', url, _params);

    const result: any = await this.postRequest(url, _params, authorization);
    if (result.status === 200 && result.prepay_id) {
      const data = {
        status: result.status,
        appid: this.appid,
        partnerid: this.mchid,
        package: 'Sign=WXPay',
        timestamp: parseInt(+new Date() / 1000 + '').toString(),
        noncestr: Math.random()
          .toString(36)
          .substr(2, 15),
        prepayid: result.prepay_id,
        sign: '',
      };
      const str = [data.appid, data.timestamp, data.noncestr, data.package, ''].join('\n');
      data.sign = this.sign(str);
      return data;
    }
    return result;
  }
  /**
   * 合单app支付
   * @param params 请求参数 object 参数介绍 请看文档https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter5_1_1.shtml
   */
  public async combine_transactions_app(params: IcombineApp): Promise<Record<string, any>> {
    // 请求参数
    const _params = {
      combine_appid: this.appid,
      combine_mchid: this.mchid,
      ...params,
    };
    const url = 'https://api.mch.weixin.qq.com/v3/combine-transactions/app';

    const authorization = this.init('POST', url, _params);

    const result: any = await this.postRequest(url, _params, authorization);
    if (result.status === 200 && result.prepay_id) {
      const data = {
        status: result.status,
        appid: this.appid,
        partnerid: this.mchid,
        package: 'Sign=WXPay',
        timestamp: parseInt(+new Date() / 1000 + '').toString(),
        noncestr: Math.random()
          .toString(36)
          .substr(2, 15),
        prepayid: result.prepay_id,
        sign: '',
      };
      const str = [data.appid, data.timestamp, data.noncestr, data.prepayid, ''].join('\n');
      data.sign = this.sign(str);
      return data;
    }
    return result;
  }
  /**
   * JSAPI支付 或者 小程序支付
   * @param params 请求参数 object 参数介绍 请看文档https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter3_1_1.shtml
   */
  public async transactions_jsapi(params: Ijsapi): Promise<Record<string, any>> {
    // 请求参数
    const _params = {
      appid: this.appid,
      mchid: this.mchid,
      ...params,
    };
    const url = 'https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi';

    const authorization = this.init('POST', url, _params);

    const result: any = await this.postRequest(url, _params, authorization);
    if (result.status === 200 && result.prepay_id) {
      const data = {
        status: result.status,
        appId: this.appid,
        timeStamp: parseInt(+new Date() / 1000 + '').toString(),
        nonceStr: Math.random()
          .toString(36)
          .substr(2, 15),
        package: `prepay_id=${result.prepay_id}`,
        signType: 'RSA',
        paySign: '',
      };
      const str = [data.appId, data.timeStamp, data.nonceStr, data.package, ''].join('\n');
      data.paySign = this.sign(str);
      return data;
    }
    return result;
  }
  /**
   * 合单JSAPI支付 或者 小程序支付
   * @param params 请求参数 object 参数介绍 请看文档https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter5_1_3.shtml
   */
  public async combine_transactions_jsapi(params: IcombineJsapi): Promise<Record<string, any>> {
    // 请求参数
    const _params = {
      combine_appid: this.appid,
      combine_mchid: this.mchid,
      ...params,
    };
    const url = 'https://api.mch.weixin.qq.com/v3/combine-transactions/jsapi';

    const authorization = this.init('POST', url, _params);

    const result: any = await this.postRequest(url, _params, authorization);
    if (result.status === 200 && result.prepay_id) {
      const data = {
        status: result.status,
        appId: this.appid,
        timeStamp: parseInt(+new Date() / 1000 + '').toString(),
        nonceStr: Math.random()
          .toString(36)
          .substr(2, 15),
        package: `prepay_id=${result.prepay_id}`,
        signType: 'RSA',
        paySign: '',
      };
      const str = [data.appId, data.timeStamp, data.nonceStr, data.package, ''].join('\n');
      data.paySign = this.sign(str);
      return data;
    }
    return result;
  }
  /**
   * 查询订单
   * @param params 请求参数 object 参数介绍 请看文档https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter3_3_2.shtml
   */
  public async query(params: Iquery1 | Iquery2): Promise<Record<string, any>> {
    let url = '';
    if (params.transaction_id) {
      url = `https://api.mch.weixin.qq.com/v3/pay/transactions/id/${params.transaction_id}?mchid=${this.mchid}`;
    } else if (params.out_trade_no) {
      url = `https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/${params.out_trade_no}?mchid=${this.mchid}`;
    } else {
      throw new Error('缺少transaction_id或者out_trade_no');
    }

    const authorization = this.init('GET', url);
    return await this.getRequest(url, authorization);
  }
  /**
   * 合单查询订单
   * @param params 请求参数 object 参数介绍 请看文档https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter5_1_11.shtml
   */
  public async combine_query(combine_out_trade_no: string): Promise<Record<string, any>> {
    if (!combine_out_trade_no) throw new Error('缺少combine_out_trade_no');
    const url = `https://api.mch.weixin.qq.com/v3/combine-transactions/out-trade-no/${combine_out_trade_no}`;

    const authorization = this.init('GET', url);
    return await this.getRequest(url, authorization);
  }
  /**
   * 关闭订单
   * @param out_trade_no 请求参数 商户订单号 参数介绍 请看文档https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter3_3_3.shtml
   */
  public async close(out_trade_no: string): Promise<Record<string, any>> {
    if (!out_trade_no) throw new Error('缺少out_trade_no');

    // 请求参数
    const _params = {
      mchid: this.mchid,
    };
    const url = `https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/${out_trade_no}/close`;
    const authorization = this.init('POST', url, _params);

    return await this.postRequest(url, _params, authorization);
  }
  /**
   * 合单关闭订单
   * @param combine_out_trade_no 请求参数 总订单号 参数介绍 请看文档https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter5_1_12.shtml
   * @param sub_orders array 子单信息
   */
  public async combine_close(combine_out_trade_no: string, sub_orders: IcloseSubOrders[]): Promise<Record<string, any>> {
    if (!combine_out_trade_no) throw new Error('缺少out_trade_no');

    // 请求参数
    const _params = {
      combine_appid: this.appid,
      sub_orders,
    };
    const url = `https://api.mch.weixin.qq.com/v3/combine-transactions/out-trade-no/${combine_out_trade_no}/close`;
    const authorization = this.init('POST', url, _params);

    return await this.postRequest(url, _params, authorization);
  }
  /**
   * 申请交易账单
   * @param params 请求参数 object 参数介绍 请看文档https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter3_1_6.shtml
   */
  public async tradebill(params: Itradebill): Promise<Record<string, any>> {
    let url = 'https://api.mch.weixin.qq.com/v3/bill/tradebill';
    const _params: any = {
      ...params,
    };
    const querystring = Object.keys(_params)
      .filter(function(key) {
        return !!_params[key];
      })
      .sort()
      .map(function(key) {
        return key + '=' + _params[key];
      })
      .join('&');
    url = url + `?${querystring}`;
    const authorization = this.init('GET', url);
    return await this.getRequest(url, authorization);
  }
  /**
   * 申请资金账单
   * @param params 请求参数 object 参数介绍 请看文档https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter3_1_7.shtml
   */
  public async fundflowbill(params: Ifundflowbill): Promise<Record<string, any>> {
    let url = 'https://api.mch.weixin.qq.com/v3/bill/fundflowbill';
    const _params: any = {
      ...params,
    };
    const querystring = Object.keys(_params)
      .filter(function(key) {
        return !!_params[key];
      })
      .sort()
      .map(function(key) {
        return key + '=' + _params[key];
      })
      .join('&');
    url = url + `?${querystring}`;
    const authorization = this.init('GET', url);
    return await this.getRequest(url, authorization);
  }
  /**
   * 下载账单
   * @param download_url 请求参数 路径 参数介绍 请看文档https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter3_1_8.shtml
   */
  public async downloadbill(download_url: string) {
    const authorization = this.init('GET', download_url);
    return await this.getRequest(download_url, authorization);
  }
  /**
   * 申请退款
   * @param 请求参数 路径 参数介绍 请看文档https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter3_2_9.shtml
   */
  public async refunds(params: Irefunds1 | Irefunds2): Promise<Record<string, any>> {
    const url = 'https://api.mch.weixin.qq.com/v3/refund/domestic/refunds';
    // 请求参数
    const _params = {
      ...params,
    };

    const authorization = this.init('POST', url, _params);

    return await this.postRequest(url, _params, authorization);
  }
  /**
   * 查询单笔退款
   * @param 请求参数 路径 参数介绍 请看文档https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter3_2_10.shtml
   */
  public async find_refunds(out_refund_no: string): Promise<Record<string, any>> {
    if (!out_refund_no) throw new Error('缺少out_refund_no');
    const url = `https://api.mch.weixin.qq.com/v3/refund/domestic/refunds/${out_refund_no}`;

    const authorization = this.init('GET', url);
    return await this.getRequest(url, authorization);
  }
}

export = Pay;

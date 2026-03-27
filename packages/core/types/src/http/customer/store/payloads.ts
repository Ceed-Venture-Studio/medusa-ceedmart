import {
  BaseCreateCustomer,
  BaseCreateCustomerAddress,
  BaseUpdateCustomer,
  BaseUpdateCustomerAddress,
} from "../common"

export interface StoreCreateCustomer extends BaseCreateCustomer {
  /**
   * The customer's password, forwarded to Pulse Identity for registration.
   */
  password: string
}
export interface StoreUpdateCustomer extends BaseUpdateCustomer {}

export interface StoreCreateCustomerAddress extends BaseCreateCustomerAddress {}
export interface StoreUpdateCustomerAddress extends BaseUpdateCustomerAddress {}

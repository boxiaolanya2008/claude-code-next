import axios from 'axios'
import { getOauthConfig } from '../../constants/oauth.js'
import { prepareApiRequest } from '../../utils/teleport/api.js'

export async function fetchReferralEligibility() {
  const { accessToken } = await prepareApiRequest()
  const oauthConfig = getOauthConfig()
  
  const response = await axios.get(`${oauthConfig.API_URL}/referrals/eligibility`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })
  
  return response.data
}

export function formatCreditAmount(reward) {
  const symbol = '$'
  const amount = reward.amount_minor_units / 100
  return `${symbol}${amount.toFixed(2)}`
}

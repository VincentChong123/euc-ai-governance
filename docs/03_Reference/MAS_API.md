Product Overview
API Type
MAS Data API (Non-sensitive)
API Provider
MAS
API Technology
REST (Swagger 2.0)
Version Overview
Description

These rates are the average of buying and selling interbank rates quoted around midday in Singapore. Note: Please include a filtering parameter in your query to access the API for Exchange Rates - End of Period – Daily data.

Use Cases

All rates are obtained, with permission, from Thomson Reuters and disseminated to the public for information and could differ from those quoted by foreign exchange dealers. The rates are not attributable to MAS and MAS does not warrant and hereby disclaims any warranty as to the accuracy, correctness, reliability, currentness, timeliness or fitness for any particular purpose of the rates. Users may wish to utilise the IMF's exchange rate database for a wider range of currencies. MAS shall not be responsible for the contents of the IMF website and is not in a position to verify the information or endorse the accuracy or reliability of any of the information or contents contained on, distributed through, or linked, downloaded or accessed from such website. MAS shall also not be responsible for any damages, including direct, indirect, incidental, punitive or consequential damages or loss of any kind whatsoever arising from access to that website.

Specifications
Sandbox (Internet)
Production (Internet)	https://eservices.mas.gov.sg/apimg-gw
API for Exchange Rates - End of Period - Daily
 1.0.0
[ Base URL: eservices.mas.gov.sg/apimg-gw/server/monthly_statistical_bulletin_non610ora/exchange_rates_end_of_period_daily ]
These rates are the average of buying and selling interbank rates quoted around midday in Singapore.

# ----------------------------------------

Returns values of view API for Exchange Rates - End of Period - Daily

Parameters
Try it out
Name	Description
end_of_day
string
(query)
End of Day | Type: Datetime (Day) YYYY-MM-DD

end_of_day
eur_sgd
string
(query)
Euro | Type: Numeric (General) | Unit of Measure: S$ Per Unit of Currency

eur_sgd
gbp_sgd
string
(query)
Pound Sterling | Type: Numeric (General) | Unit of Measure: S$ Per Unit of Currency

gbp_sgd
usd_sgd
string
(query)
US Dollar | Type: Numeric (General) | Unit of Measure: S$ Per Unit of Currency

usd_sgd
aud_sgd
string
(query)
Australian Dollar | Type: Numeric (General) | Unit of Measure: S$ Per Unit of Currency

aud_sgd
cad_sgd
string
(query)
Canadian Dollar | Type: Numeric (General) | Unit of Measure: S$ Per Unit of Currency

cad_sgd
cny_sgd_100
string
(query)
Chinese Renminbi | Type: Numeric (General) | Unit of Measure: S$ Per 100 Units of Currency

cny_sgd_100
hkd_sgd_100
string
(query)
Hong Kong Dollar | Type: Numeric (General) | Unit of Measure: S$ Per 100 Units of Currency

hkd_sgd_100
inr_sgd_100
string
(query)
Indian Rupee | Type: Numeric (General) | Unit of Measure: S$ Per 100 Units of Currency

inr_sgd_100
idr_sgd_100
string
(query)
Indonesian Rupiah | Type: Numeric (General) | Unit of Measure: S$ Per 100 Units of Currency

idr_sgd_100
jpy_sgd_100
string
(query)
Japanese Yen | Type: Numeric (General) | Unit of Measure: S$ Per 100 Units of Currency

jpy_sgd_100
krw_sgd_100
string
(query)
Korean Won | Type: Numeric (General) | Unit of Measure: S$ Per 100 Units of Currency

krw_sgd_100
myr_sgd_100
string
(query)
Malaysian Ringgit | Type: Numeric (General) | Unit of Measure: S$ Per 100 Units of Currency

myr_sgd_100
twd_sgd_100
string
(query)
New Taiwan Dollar | Type: Numeric (General) | Unit of Measure: S$ Per 100 Units of Currency

twd_sgd_100
nzd_sgd
string
(query)
New Zealand Dollar | Type: Numeric (General) | Unit of Measure: S$ Per Unit of Currency

nzd_sgd
php_sgd_100
string
(query)
Philippine Peso | Type: Numeric (General) | Unit of Measure: S$ Per 100 Units of Currency

php_sgd_100
qar_sgd_100
string
(query)
Qatar Riyal | Type: Numeric (General) | Unit of Measure: S$ Per 100 Units of Currency

qar_sgd_100
sar_sgd_100
string
(query)
Saudi Arabia Riyal | Type: Numeric (General) | Unit of Measure: S$ Per 100 Units of Currency

sar_sgd_100
chf_sgd
string
(query)
Swiss Franc | Type: Numeric (General) | Unit of Measure: S$ Per Unit of Currency

chf_sgd
thb_sgd_100
string
(query)
Thai Baht | Type: Numeric (General) | Unit of Measure: S$ Per 100 Units of Currency

thb_sgd_100
aed_sgd_100
string
(query)
UAE Dirham | Type: Numeric (General) | Unit of Measure: S$ Per 100 Units of Currency

aed_sgd_100
vnd_sgd_100
string
(query)
Vietnamese Dong | Type: Numeric (General) | Unit of Measure: S$ Per 100 Units of Currency

vnd_sgd_100
$orderby
array[string]
(query)
Sorts the results by one or more fields. It is a comma-separated list of fields, each one followed by the modifier ASC (for ascending order) and DESC (for descending order).

$count
integer
(query)
Used for pagination in view resources

$count
$start_index
integer
(query)
Used for pagination in view resources

$start_index
Responses
Response content type

application/json; charset=UTF-8
Code	Description
200
Success

204
No results were returned

400
Bad request

401
Authentication failed

403
Insufficient permissions to perform this request

500
Runtime error


# Python
Code Snippet (1.0.6)

import urllib3

http = urllib3.PoolManager()

response = http.request('GET', 'https://eservices.mas.gov.sg/apimg-gw/server/monthly_statistical_bulletin_non610ora/exchange_rates_end_of_period_daily/views/exchange_rates_end_of_period_daily', headers={
    'keyid': 'XXX'
})
print(response.data)
print(response.data.decode('utf-8'))
print(response.status)
print(response.headers['Content-Type'])

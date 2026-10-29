# rngdle

client for [rngdle.com](https://www.rngdle.com).

```js
import { RngdleClient } from "@mimi_py/rngdle";

const rngdle = new RngdleClient(process.env.RNGDLE_COOKIE);

const { rolls, bestRoll } = await rngdle.getRolls("mimi_py");
const requests = await rngdle.getFriendRequests();
```

Rolls are public. Friend routes need the cookie from a logged-in browser (`__Secure-better-auth.session_token` and `rngdle_user`, the whole `Cookie` header is fine).

To your `Cookies` from `RNGdle`: 
 - Open the [Friends](https://www.rngdle.com/friends) tab.
 - Press Ctrl + Shift + i simultaneously or right click -> inspect.
![descriptor](https://i.postimg.cc/3JYPhDF1/image.png)
 - Open the Network Tab from the top of the inspector.
 - Refresh the page, you will see a `Fetch` request `get-session`.
![descriptor](https://i.postimg.cc/9Mqj45DZ/image.png)
 - Open the fetch requests Headers, and look for `Cookies`.
 - Right click and copy the value. 

`sendFriendRequest(username, userId)` wants their account id. `fetchUsers(username)` returns those. 
`acceptFriendRequest` wants the request id from `getFriendRequests()`.

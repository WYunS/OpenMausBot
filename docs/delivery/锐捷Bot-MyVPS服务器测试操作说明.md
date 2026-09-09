# 锐捷 Bot My VPS 服务器测试操作说明

## 目标

验证锐捷 Bot 能通过 SSH 控制一个独立的 Linux 桌面容器。

## 连接方式

测试入口使用管理员提供的堡垒机 SSH 地址和端口。正式接入锐捷 Bot 前，需要配置一个 SSH 别名：

```sshconfig
Host ruijie-bot-vps-test
    HostName <管理员提供的 Host>
    Port <管理员提供的 Port>
    User "<管理员提供的 User>"
    IdentityFile ~/.ssh/ruijie_bot_test
    ServerAliveInterval 30
    ServerAliveCountMax 3
```

先验证 SSH 和远程 Docker：

```bash
ssh ruijie-bot-vps-test true
docker -H ssh://ruijie-bot-vps-test info
```

锐捷 Bot 不保存服务器密码。测试账号需要配置 SSH 公钥，确保以上命令可以免交互执行。

## 操作步骤

### 1. 只读检查

首次连接只执行：

```bash
hostname
free -h
df -h
docker version
docker ps
docker images
docker network ls
docker system df
```

确认 CPU、内存、磁盘余量，并记录现有容器和网络。

### 2. 准备测试镜像

由项目侧提供包含 XFCE、浏览器、noVNC、CUA Driver、中文环境、飞书和飞连的测试镜像。管理员通过内网仓库拉取，或执行：

```bash
docker load -i ruijie-bot-desktop-test.tar
```

镜像提前导入后，锐捷 Bot 不在服务器上临时构建镜像。

### 3. 启动一个测试容器

锐捷 Bot 通过 My VPS 创建一个名称以 `openmausbot-vps-` 开头的容器，限制为 2 CPU、4 GB 内存。

测试容器遵守以下约束：

- 使用 Docker 默认 `bridge` 网络；
- 不加入 Traefik 网络；
- 不设置 Traefik 标签；
- 不映射宿主机端口；
- 不挂载现有业务目录；
- 不停止、重启或删除任何现有容器。

noVNC 画面通过 SSH 隧道访问，不对外开放 VNC 端口。

### 4. 功能验证

依次验证：

1. 容器和 XFCE 桌面启动；
2. CUA Driver 健康检查；
3. 锐捷 Bot 截图、点击和输入；
4. noVNC 画面查看与人工接管；
5. 浏览器联网；
6. 飞书和飞连客户端启动；
7. 停止并重新启动测试容器后恢复正常。

## 不影响现有业务的保证

测试期间禁止执行：

```text
docker system prune
docker container prune
docker network prune
docker volume prune
```

所有新增资源使用 `openmausbot` 前缀。操作前按完整容器名称和 Docker ID 二次确认，不使用模糊匹配批量删除。

## 回滚

先只读列出测试容器：

```bash
docker ps -a --filter "name=openmausbot-vps-"
```

确认完整名称和 ID 后，只停止、删除本次创建的测试容器。需要删除测试镜像时，同样先确认镜像 ID；不处理任何现有业务镜像、网络、数据卷或 Traefik 配置。
